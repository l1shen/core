import { Injectable, Autowired } from '@ali/common-di';
import { JsonSchemaStore, InMemoryResourceResolver, deepClone, IJSONSchema, URI } from '@ali/ide-core-browser';
import { DebugService } from '../common/debug-service';
import { debugPreferencesSchema } from './debug-preferences';

@Injectable()
export class DebugSchemaUpdater {

    @Autowired(JsonSchemaStore)
    protected readonly jsonSchemaStore: JsonSchemaStore;

    @Autowired(InMemoryResourceResolver)
    protected readonly inmemoryResources: InMemoryResourceResolver;

    @Autowired(DebugService)
    protected readonly debug: DebugService;

    async update(): Promise<void> {
        const types = await this.debug.debugTypes();
        const schema = { ...deepClone(launchSchema) };
        const items = (schema!.properties!.configurations.items as IJSONSchema);

        const attributePromises = types.map((type) => this.debug.getSchemaAttributes(type));
        for (const attributes of await Promise.all(attributePromises)) {
            for (const attribute of attributes) {
                const properties: typeof attribute['properties'] = {};
                for (const key of ['debugViewLocation', 'openDebug', 'internalConsoleOptions']) {
                    properties[key] = debugPreferencesSchema.properties[`debug.${key}`];
                }
                attribute.properties = Object.assign(properties, attribute.properties);
                items.oneOf!.push(attribute);
            }
        }
        items.defaultSnippets!.push(...await this.debug.getConfigurationSnippets());

        const uri = new URI(launchSchemaId);
        const contents = JSON.stringify(schema);
        try {
            this.inmemoryResources.update(uri, contents);
        } catch (e) {
            this.inmemoryResources.add(uri, contents);
            this.jsonSchemaStore.registerSchema({
                fileMatch: ['launch.json'],
                url: uri.toString(),
            });
        }
    }
}

export const launchSchemaId = 'vscode://schemas/launch';

const launchSchema: IJSONSchema = {
    $id: launchSchemaId,
    type: 'object',
    title: 'Launch',
    required: [],
    default: { version: '0.2.0', configurations: [] },
    properties: {
        version: {
            type: 'string',
            description: 'Version of this file format.',
            default: '0.2.0',
        },
        configurations: {
            type: 'array',
            description: 'List of configurations. Add new configurations or edit existing ones by using IntelliSense.',
            items: {
                defaultSnippets: [],
                'type': 'object',
                oneOf: [],
            },
        },
    },
};
