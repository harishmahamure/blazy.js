/**
 * WebSocket Module — Example real-time module
 *
 * Demonstrates:
 * - WebSocket route registration via uWS native API
 * - Room/topic-based pub/sub
 * - Binary and text message handling
 * - Connection lifecycle
 */

import uWS from 'uWebSockets.js';
import type { App } from '../../core/app.js';

interface WsUserData {
  url: string;
  query: string;
}

interface WsMessage {
  type: string;
  topic?: string;
  message?: string;
}

export interface WebSocketModuleConfig {
  maxPayloadLength?: number;
  idleTimeout?: number;
}

function decodeMessage(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('utf8');
}

export function websocketModule(app: App, config: WebSocketModuleConfig = {}): void {
  const maxPayloadLength = config.maxPayloadLength || 16 * 1024;
  const idleTimeout = config.idleTimeout || 120;

  let connectionCount = 0;
  app.container.set('ws.connectionCount', () => connectionCount);

  const behavior: uWS.WebSocketBehavior<WsUserData> = {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength,
    idleTimeout,
    maxBackpressure: 1024 * 1024,

    upgrade(res, req, context) {
      const query = req.getQuery();
      const url = req.getUrl();

      res.upgrade<WsUserData>(
        { url, query },
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      );
    },

    open(ws) {
      connectionCount++;
      ws.subscribe('broadcast');
      app.logger.debug({ msg: 'WebSocket connected', connections: connectionCount });
    },

    message(ws, message, isBinary) {
      if (isBinary) {
        ws.send(message, true);
        return;
      }

      const text = decodeMessage(message);

      try {
        const data = JSON.parse(text) as WsMessage;

        switch (data.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
            break;

          case 'subscribe':
            if (data.topic) {
              ws.subscribe(data.topic);
              ws.send(JSON.stringify({ type: 'subscribed', topic: data.topic }));
            }
            break;

          case 'unsubscribe':
            if (data.topic) {
              ws.unsubscribe(data.topic);
              ws.send(JSON.stringify({ type: 'unsubscribed', topic: data.topic }));
            }
            break;

          case 'publish':
            if (data.topic && data.message) {
              ws.publish(
                data.topic,
                JSON.stringify({
                  type: 'message',
                  topic: data.topic,
                  message: data.message,
                  time: Date.now(),
                })
              );
            }
            break;

          case 'broadcast':
            ws.publish(
              'broadcast',
              JSON.stringify({
                type: 'message',
                topic: 'broadcast',
                message: data.message,
                time: Date.now(),
              })
            );
            break;

          default:
            ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${data.type}` }));
        }
      } catch {
        ws.send(text);
      }
    },

    drain(ws) {
      app.logger.debug({ msg: 'WebSocket drain', buffered: ws.getBufferedAmount() });
    },

    close(_ws, code) {
      connectionCount--;
      app.logger.debug({ msg: 'WebSocket disconnected', code, connections: connectionCount });
    },
  };

  app.ws<WsUserData>('/ws', behavior);
}
