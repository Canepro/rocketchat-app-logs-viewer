import { IAppAccessors, IConfigurationExtend, IEnvironmentRead, ILogger } from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { ExternalComponentLocation } from '@rocket.chat/apps-engine/definition/externalComponent/IExternalComponent';
import { AppMethod } from '@rocket.chat/apps-engine/definition/metadata';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { IUIKitInteractionHandler } from '@rocket.chat/apps-engine/definition/uikit/IUIKitActionHandler';
import { IUIKitResponse } from '@rocket.chat/apps-engine/definition/uikit/IUIKitInteractionType';
import { UIKitBlockInteractionContext } from '@rocket.chat/apps-engine/definition/uikit/UIKitInteractionContext';

import { createAppApi } from './src/api';
import { LogsSlashCommand } from './src/commands/LogsSlashCommand';
import { handleSlashCardBlockAction } from './src/commands/slashCardActionHandler';
import { EXTERNAL_COMPONENT } from './src/constants';
import { settings } from './src/settings';

export class LogsViewerApp extends App implements IUIKitInteractionHandler {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    protected async extendConfiguration(configuration: IConfigurationExtend, _environmentRead: IEnvironmentRead): Promise<void> {
        // Register app settings first so API/command modules can safely read configuration.
        for (const setting of settings) {
            await configuration.settings.provideSetting(setting);
        }

        // Register command, API, and external component entrypoint for the current app ID.
        await configuration.slashCommands.provideSlashCommand(new LogsSlashCommand(this.getID()));
        await configuration.api.provideApi(createAppApi(this));
        await configuration.externalComponents.register({
            appId: this.getID(),
            name: EXTERNAL_COMPONENT.NAME,
            description: EXTERNAL_COMPONENT.DESCRIPTION,
            icon: EXTERNAL_COMPONENT.ICON_URL,
            location: ExternalComponentLocation.CONTEXTUAL_BAR,
            url: EXTERNAL_COMPONENT.DEFAULT_URL,
        });
    }

    public async [AppMethod.UIKIT_BLOCK_ACTION](
        context: UIKitBlockInteractionContext,
        read: Parameters<NonNullable<IUIKitInteractionHandler[typeof AppMethod.UIKIT_BLOCK_ACTION]>>[1],
        _http: Parameters<NonNullable<IUIKitInteractionHandler[typeof AppMethod.UIKIT_BLOCK_ACTION]>>[2],
        persistence: Parameters<NonNullable<IUIKitInteractionHandler[typeof AppMethod.UIKIT_BLOCK_ACTION]>>[3],
        modify: Parameters<NonNullable<IUIKitInteractionHandler[typeof AppMethod.UIKIT_BLOCK_ACTION]>>[4],
    ): Promise<IUIKitResponse> {
        const interaction = context.getInteractionData();
        // Centralized handler keeps slash-card actions private-by-default and role-audited.
        await handleSlashCardBlockAction(this.getID(), interaction, read, modify, persistence);
        return context.getInteractionResponder().successResponse();
    }
}
