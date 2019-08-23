import * as fs from 'fs';
import * as nsfw from 'nsfw';
import * as paths from 'path';
import { IMinimatch, Minimatch } from 'minimatch';
import { IDisposable, Disposable, DisposableCollection } from '@ali/ide-core-common';
import { FileUri } from '@ali/ide-core-node';
import {
  FileChangeType,
  FileSystemWatcherClient,
  FileSystemWatcherServer,
  WatchOptions,
} from '../common/file-service-watcher-protocol';
import { FileChangeCollection } from './file-change-collection';
import { setInterval, clearInterval } from 'timers';
import debounce = require('lodash.debounce');

export interface WatcherOptions {
  ignored: IMinimatch[];
}

export class NsfwFileSystemWatcherServer implements FileSystemWatcherServer {

  protected client: FileSystemWatcherClient | undefined;

  protected watcherSequence = 1;
  protected readonly watchers = new Map<number, {path: string, disposable: IDisposable}>();
  protected readonly watcherOptions = new Map<number, WatcherOptions>();

  protected readonly toDispose = new DisposableCollection(
    Disposable.create(() => this.setClient(undefined)),
  );

  protected changes = new FileChangeCollection();

  protected readonly options: {
    verbose: boolean
    info: (message: string, ...args: any[]) => void
    error: (message: string, ...args: any[]) => void,
  };

  constructor(options?: {
    verbose?: boolean,
    info?: (message: string, ...args: any[]) => void
    error?: (message: string, ...args: any[]) => void,
  }) {
    this.options = {
      verbose: false,
      info: (message, ...args) => console.info(message, ...args),
      error: (message, ...args) => console.error(message, ...args),
      ...options,
    };
  }

  dispose(): void {
    this.toDispose.dispose();
  }

  getWatcherId(watcherPath: string): number {
    let watcherId;
    this.watchers.forEach((watcher, id) => {
      if (watcherPath.indexOf(watcher.path) === 0) {
        watcherId = id;
      }
    });
    return watcherId;
  }

  async watchFileChanges(uri: string, options?: WatchOptions): Promise<number> {
    const basePath = FileUri.fsPath(uri);
    const realpath = fs.realpathSync(basePath);
    let watcherId = this.getWatcherId(realpath);
    // Place repeat listeners
    if (watcherId) {
      return watcherId;
    }
    watcherId = this.watcherSequence++;
    this.debug('Starting watching:', basePath);
    const toDisposeWatcher = new DisposableCollection();
    this.watchers.set(watcherId, {
      path: realpath,
      disposable: toDisposeWatcher,
    });
    toDisposeWatcher.push(Disposable.create(() => this.watchers.delete(watcherId)));
    if (fs.existsSync(basePath)) {
      this.start(watcherId, basePath, options, toDisposeWatcher);
    } else {
      const toClearTimer = new DisposableCollection();
      const timer = setInterval(() => {
        if (fs.existsSync(basePath)) {
          toClearTimer.dispose();
          this.pushAdded(watcherId, basePath);
          this.start(watcherId, basePath, options, toDisposeWatcher);
        }
      }, 500);
      toClearTimer.push(Disposable.create(() => clearInterval(timer)));
      toDisposeWatcher.push(toClearTimer);
    }
    this.toDispose.push(toDisposeWatcher);
    return watcherId;
  }

  protected trimChangeEvent(events: nsfw.ChangeEvent[]): nsfw.ChangeEvent[] {
    if (events.length < 2) {
      return events;
    }
    const eventMap: Map<string, {
      index: number,
      event: nsfw.ChangeEvent,
    }[] | []> = new Map();

    const shouldDeleteIndex: number[] = [];
    // 找到同一个文件的所有 event
    events.forEach((event: nsfw.ChangeEvent, index) => {
      if (!event.file) {
        return;
      }
      const file = event.file;
      const list = eventMap.get(file) || [];
      list.push({
        index,
        event,
      });
      eventMap.set(event.file, list);
    });

    // 确定无效的 event
    eventMap.forEach((eventList) => {
      if (eventList.length < 2) {
        return;
      }
      if (eventList[0].event.action === nsfw.actions.DELETED &&
          eventList[1].event.action === nsfw.actions.CREATED) {
        // 先DELETED 后CREATED 合并为 UPDATE
        events[eventList[0].index].action = nsfw.actions.MODIFIED;
        shouldDeleteIndex.push(eventList[1].index);
      }
      if (eventList[0].event.action === nsfw.actions.CREATED &&
        eventList[1].event.action === nsfw.actions.DELETED) {
        // 先CREATED 后 DELETED 均忽略
        shouldDeleteIndex.push(eventList[0].index);
        shouldDeleteIndex.push(eventList[1].index);
      }
    });

    // 移除无效的 event
    events = events.filter((event, index) => {
      return shouldDeleteIndex.indexOf(index) < 0;
    });

    return events;
  }

  protected async start(watcherId: number, basePath: string, rawOptions: WatchOptions | undefined, toDisposeWatcher: DisposableCollection): Promise<void> {
    const options: WatchOptions = {
      ignored: [],
      ...rawOptions,
    };
    if (options.ignored.length > 0) {
      this.debug('Files ignored for watching', options.ignored);
    }

    let watcher: nsfw.NSFW | undefined = await nsfw(fs.realpathSync(basePath), (events: nsfw.ChangeEvent[]) => {
      events = this.trimChangeEvent(events);
      for (const event of events) {
        if (event.action === nsfw.actions.CREATED) {
          this.pushAdded(watcherId, this.resolvePath(event.directory, event.file!));
        }
        if (event.action === nsfw.actions.DELETED) {
          this.pushDeleted(watcherId, this.resolvePath(event.directory, event.file!));
        }
        if (event.action === nsfw.actions.MODIFIED) {
          this.pushUpdated(watcherId, this.resolvePath(event.directory, event.file!));
        }
        if (event.action === nsfw.actions.RENAMED) {
          this.pushDeleted(watcherId, this.resolvePath(event.directory, event.oldFile!));
          this.pushAdded(watcherId, this.resolvePath(event.directory, event.newFile!));
        }
      }
    }, {
        errorCallback: (error: any) => {
          // see https://github.com/atom/github/issues/342
          console.warn(`Failed to watch "${basePath}":`, error);
          this.unwatchFileChanges(watcherId);
        },
      });
    await watcher.start();
    // this.options.info('Started watching:', basePath);
    if (toDisposeWatcher.disposed) {
      this.debug('Stopping watching:', basePath);
      await watcher.stop();
      // remove a reference to nsfw otherwise GC cannot collect it
      watcher = undefined;
      this.options.info('Stopped watching:', basePath);
      return;
    }
    toDisposeWatcher.push(Disposable.create(async () => {
      this.watcherOptions.delete(watcherId);
      if (watcher) {
        this.debug('Stopping watching:', basePath);
        await watcher.stop();
        // remove a reference to nsfw otherwise GC cannot collect it
        watcher = undefined;
        this.options.info('Stopped watching:', basePath);
      }
    }));
    this.watcherOptions.set(watcherId, {
      ignored: options.ignored.map((pattern) => new Minimatch(pattern)),
    });
  }

  unwatchFileChanges(watcherId: number): Promise<void> {
    const watcher = this.watchers.get(watcherId);
    if (watcher) {
      this.watchers.delete(watcherId);
      watcher.disposable.dispose();
    }
    return Promise.resolve();
  }

  setClient(client: FileSystemWatcherClient | undefined) {
    if (client && this.toDispose.disposed) {
      return;
    }
    this.client = client;
  }

  protected pushAdded(watcherId: number, path: string): void {
    this.debug('Added:', `${watcherId}:${path}`);
    this.pushFileChange(watcherId, path, FileChangeType.ADDED);
  }

  protected pushUpdated(watcherId: number, path: string): void {
    this.debug('Updated:', `${watcherId}:${path}`);
    this.pushFileChange(watcherId, path, FileChangeType.UPDATED);
  }

  protected pushDeleted(watcherId: number, path: string): void {
    this.debug('Deleted:', `${watcherId}:${path}`);
    this.pushFileChange(watcherId, path, FileChangeType.DELETED);
  }

  protected pushFileChange(watcherId: number, path: string, type: FileChangeType): void {
    if (this.isIgnored(watcherId, path)) {
      return;
    }

    const uri = FileUri.create(path).toString();
    this.changes.push({ uri, type });

    this.fireDidFilesChanged();
  }

  protected resolvePath(directory: string, file: string): string {
    const path = paths.join(directory, file);
    try {
      return fs.realpathSync(path);
    } catch (e) {
      try {
        // file does not exist try to resolve directory
        return paths.join(fs.realpathSync(directory), file);
      } catch (e) {
        // directory does not exist fall back to symlink
        return path;
      }
    }
  }

  /**
   * Fires file changes to clients.
   * It is debounced in the case if the filesystem is spamming to avoid overwhelming clients with events.
   */
  protected readonly fireDidFilesChanged: () => void = debounce(() => this.doFireDidFilesChanged(), 50);
  protected doFireDidFilesChanged(): void {
    const changes = this.changes.values();
    this.changes = new FileChangeCollection();
    const event = { changes };
    if (this.client) {
      this.client.onDidFilesChanged(event);
    }
  }

  protected isIgnored(watcherId: number, path: string): boolean {
    const options = this.watcherOptions.get(watcherId);
    return !!options && options.ignored.length > 0 && options.ignored.some((m) => m.match(path));
  }

  protected debug(message: string, ...params: any[]): void {
    if (this.options.verbose) {
      this.options.info(message, ...params);
    }
  }

}
