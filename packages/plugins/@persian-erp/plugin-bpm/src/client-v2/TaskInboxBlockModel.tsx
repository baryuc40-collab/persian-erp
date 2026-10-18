import { BlockModel } from '@nocobase/client-v2';
import React from 'react';
import { tExpr } from './locale';
import { TaskApi, TaskInbox } from './TaskInbox';

/** The task inbox as a block of modern pages, under "Other blocks" (STORY-082). */
export class BpmTaskInboxBlockModel extends BlockModel {
  renderComponent() {
    return <TaskInbox api={this.context.api as TaskApi} />;
  }
}

BpmTaskInboxBlockModel.define({
  label: tExpr('Task inbox'),
});

export default BpmTaskInboxBlockModel;
