import * as React from 'react';
import * as cls from 'classnames';
import * as styles from '../file-tree-node.module.less';
import { TreeNode, CompositeTreeNode, INodeRendererProps, ClasslistComposite, PromptHandle, TreeNodeType, RenamePromptHandle, NewPromptHandle } from '@ali/ide-components';
import { LabelService } from '@ali/ide-core-browser/lib/services';
import { getIcon, URI } from '@ali/ide-core-browser';
import { Directory, File } from '../file-tree-nodes';
import { Loading } from '@ali/ide-core-browser/lib/components/loading';

export interface IFileTreeDialogNodeProps {
  item: any;
  defaultLeftPadding?: number;
  leftPadding?: number;
  labelService: LabelService;
  decorations?: ClasslistComposite;
  onTwistierClick?: (ev: React.MouseEvent, item: TreeNode | CompositeTreeNode, type: TreeNodeType) => void;
  onClick: (ev: React.MouseEvent, item: TreeNode | CompositeTreeNode, type: TreeNodeType) => void;
  onContextMenu?: (ev: React.MouseEvent, item: TreeNode | CompositeTreeNode, type: TreeNodeType) => void;
  template?: React.JSXElementConstructor<any>;
}

export type FileTreeDialogNodeRenderedProps = IFileTreeDialogNodeProps & INodeRendererProps;

export const FileTreeDialogNode: React.FC<FileTreeDialogNodeRenderedProps> = ({
  item,
  onClick,
  onContextMenu,
  itemType,
  labelService,
  leftPadding = 8,
  onTwistierClick,
  decorations,
  defaultLeftPadding = 8,
  template: Template,
}: FileTreeDialogNodeRenderedProps) => {
  const isRenamePrompt = itemType === TreeNodeType.RenamePrompt;
  const isNewPrompt = itemType === TreeNodeType.NewPrompt;
  const isPrompt = isRenamePrompt || isNewPrompt;

  const handleClick = (ev: React.MouseEvent) => {
    if (itemType === TreeNodeType.TreeNode || itemType === TreeNodeType.CompositeTreeNode) {
      onClick(ev, item as File, itemType);
    }
  };

  const handlerTwistierClick = (ev: React.MouseEvent) => {
    if (itemType === TreeNodeType.TreeNode || itemType === TreeNodeType.CompositeTreeNode) {
      if (onTwistierClick) {
        onTwistierClick(ev, item as File, itemType);
      } else {
        onClick(ev, item as File, itemType);
      }
    }
  };

  const handleContextMenu = (ev: React.MouseEvent) => {
    if (ev.nativeEvent.which === 0 || !onContextMenu) {
      return;
    }
    if (itemType ===  TreeNodeType.TreeNode || itemType === TreeNodeType.CompositeTreeNode) {
      onContextMenu(ev, item as TreeNode, itemType);
    }
  };

  const isDirectory = itemType === TreeNodeType.CompositeTreeNode;
  let paddingLeft;
  if (isPrompt) {
    if (isNewPrompt) {
      paddingLeft = `${defaultLeftPadding + ((item as NewPromptHandle).parent.depth + 1 || 0) * (leftPadding || 0)}px`;
    } else {
      paddingLeft = `${defaultLeftPadding + ((item as RenamePromptHandle).target.depth || 0) * (leftPadding || 0)}px`;
    }
  } else {
    paddingLeft = isDirectory ? `${defaultLeftPadding + (item.depth || 0) * (leftPadding || 0)}px` : `${defaultLeftPadding + (item.depth || 0) * (leftPadding || 0) + 8}px`;
  }
  const fileTreeNodeStyle = {
    height: FILE_TREE_NODE_HEIGHT,
    lineHeight: `${FILE_TREE_NODE_HEIGHT}px`,
    paddingLeft,
  } as React.CSSProperties;

  const renderFolderToggle = (node: Directory | PromptHandle, clickHandler: any) => {
    if (decorations && decorations?.classlist.indexOf(styles.mod_loading) > -1) {
      return <Loading />;
    }
    if (isPrompt && node instanceof PromptHandle) {
      let isDirectory: boolean = false;
      if (isRenamePrompt) {
        isDirectory = ((node as RenamePromptHandle).target).type === TreeNodeType.CompositeTreeNode;
      } else {
        isDirectory = (node as NewPromptHandle).type === TreeNodeType.CompositeTreeNode;
      }
      if (isDirectory) {
        return <div
          className={cls(
            styles.file_tree_node_segment,
            styles.expansion_toggle,
            getIcon('arrow-right'),
            { [`${styles.mod_collapsed}`]:
              isNewPrompt || !(isRenamePrompt &&
              ((node as RenamePromptHandle).target).type === TreeNodeType.CompositeTreeNode &&
              ((node as RenamePromptHandle).target as Directory).expanded)},
          )}
        />;
      }
    } else {
      return <div
        onClick={clickHandler}
        className={cls(
          styles.file_tree_node_segment,
          styles.expansion_toggle,
          getIcon('arrow-right'),
          { [`${styles.mod_collapsed}`]: !(node as Directory).expanded },
        )}
      />;
    }

  };

  const renderIcon = (node: Directory | File) => {
    let nodeUri: URI;
    let isDirectory: boolean;
    if (isPrompt && node instanceof PromptHandle) {
      if (node instanceof RenamePromptHandle) {
        nodeUri = ((node as RenamePromptHandle).target! as (File | Directory)).uri.resolve(node.$.value);
        isDirectory = Directory.is((node as RenamePromptHandle).target);
      } else {
        nodeUri = (node.parent! as Directory).uri.resolve(node.$.value);
        isDirectory = node.type === TreeNodeType.CompositeTreeNode;
      }
    } else {
      nodeUri = node.uri;
      isDirectory = node.filestat.isDirectory;
    }
    const iconClass = labelService.getIcon(nodeUri, {isDirectory});
    return <div className={cls(styles.file_icon, iconClass, {expanded: isDirectory && (node as Directory).expanded})} style={{ height: FILE_TREE_NODE_HEIGHT, lineHeight: `${FILE_TREE_NODE_HEIGHT}px`}}>
    </div>;
  };

  const renderDisplayName = (node: Directory | File) => {
    if (Template) {
      return <Template />;
    }
    if (isPrompt && node instanceof PromptHandle) {
      return <div
          className={cls(styles.file_tree_node_segment, styles.file_tree_node_inputbox)}
        >
          <div className={cls('input-box', styles.file_tree_node_prompt_box)}>
            <node.ProxiedInput  wrapperStyle={{height: FILE_TREE_NODE_HEIGHT, padding: '0 5px'}}/>
          </div>
        </div>;
    }
    return <div
        className={cls(styles.file_tree_node_segment, styles.file_tree_node_displayname)}
      >
        {node.name}
      </div>;
  };

  const renderStatusTail = () => {
    return <div className={cls(styles.file_tree_node_segment, styles.file_tree_node_tail)}>
      {renderBadge()}
    </div>;
  };

  const renderBadge = () => {
    return null;
  };

  const renderTwice = (item) => {
    if (isDirectory) {
      return renderFolderToggle(item, handlerTwistierClick);
    } else if (isPrompt) {
      return renderFolderToggle(item, () => {});
    }
  };

  const getItemTooltip = () => {
    const tooltip = item.tooltip;
    return tooltip || item.name;
  };

  return (
    <div
        key={item.id}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={getItemTooltip()}
        className={cls(
          styles.file_tree_node,
          decorations ? decorations.classlist : null,
        )}
        style={fileTreeNodeStyle}
        draggable={itemType === TreeNodeType.TreeNode || itemType === TreeNodeType.CompositeTreeNode}
      >
        <div className={cls(styles.file_tree_node_content)}>
          {renderTwice(item)}
          {renderIcon(item)}
          <div
            className={isPrompt ? styles.file_tree_node_prompt_wrap : styles.file_tree_node_overflow_wrap}
          >
            {renderDisplayName(item)}
          </div>
          {renderStatusTail()}
        </div>
      </div>
  );
};

export const FILE_TREE_NODE_HEIGHT = 22;
export const FILE_TREE_BADGE_LIMIT = 99;