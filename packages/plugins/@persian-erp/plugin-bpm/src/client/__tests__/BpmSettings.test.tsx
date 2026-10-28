import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import React from 'react';
import { BpmApi, BpmSettings } from '../BpmSettings';

// Settings > BPMN engine (STORY-079). Without translations loaded the test sees the English keys.

const renderPage = (api: BpmApi) =>
  render(
    <App>
      <BpmSettings api={api} />
    </App>,
  );

describe('Settings > BPMN engine', () => {
  it('shows the saved connection without its password, and the deployed models', async () => {
    const api: BpmApi = {
      request: vi.fn(async ({ url }) => {
        if (url === 'bpm:getSettings') {
          return {
            data: {
              data: {
                engine: 'operaton',
                url: 'http://operaton:8080',
                username: 'nocobase',
                hasPassword: true,
                fromEnv: false,
              },
            },
          };
        }
        if (url === 'bpm:processes') {
          return { data: { data: [{ id: 'p:1', key: 'purchase_request', name: 'درخواست خرید', version: 2 }] } };
        }
        return { data: { data: {} } };
      }),
    };
    renderPage(api);
    expect(await screen.findByText('purchase_request')).toBeTruthy();
    expect(screen.getByText('درخواست خرید')).toBeTruthy();
    expect((screen.getByLabelText('Engine address') as HTMLInputElement).value).toBe('http://operaton:8080');
    expect(screen.getByText('Operaton')).toBeTruthy();
    expect(screen.getByText('For example http://operaton:8080, without /engine-rest')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deploy a BPMN file' })).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Leave empty to keep the saved password')).toBeTruthy();
    expect(screen.queryByText(/comes from the server environment/)).toBeNull();
  });

  it('says when the connection comes from the environment, saves and tests it', async () => {
    const api: BpmApi = {
      request: vi.fn(async ({ url, data }) => {
        if (url === 'bpm:getSettings') {
          return {
            data: { data: { url: 'http://camunda:8080', username: 'nocobase', hasPassword: true, fromEnv: true } },
          };
        }
        if (url === 'bpm:saveSettings') return { data: { data: { ...data, hasPassword: true, fromEnv: false } } };
        if (url === 'bpm:test') return { data: { data: { version: '2.1.5' } } };
        return { data: { data: [] } };
      }),
    };
    renderPage(api);
    expect(await screen.findByText(/comes from the server environment/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Engine address'), { target: { value: 'http://bpm.local:8080' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith({
        url: 'bpm:saveSettings',
        method: 'post',
        data: { engine: 'camunda8', url: 'http://bpm.local:8080', username: 'nocobase', password: '' },
      }),
    );
    await waitFor(() => expect(screen.queryByText(/comes from the server environment/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Test the connection' }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith({ url: 'bpm:test', method: 'post' }));
  });

  it('shows the engine error instead of the models when the engine cannot be reached', async () => {
    const api: BpmApi = {
      request: vi.fn(async ({ url }) => {
        if (url === 'bpm:getSettings') {
          return { data: { data: { url: 'http://operaton:8080', username: '', hasPassword: false, fromEnv: false } } };
        }
        throw {
          response: { data: { errors: [{ message: 'The BPMN engine cannot be reached: connect ECONNREFUSED' }] } },
        };
      }),
    };
    renderPage(api);
    expect(await screen.findByText('The BPMN engine cannot be reached: connect ECONNREFUSED')).toBeTruthy();
  });
});
