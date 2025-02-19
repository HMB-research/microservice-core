/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import HttpStatus from "http-status";
import {ParsedUrlQuery} from "querystring";
import {firstValueFrom, ReplaySubject} from "rxjs";
import URL from "url";
import {TextDecoder} from "util";
import * as uWS from "uWebSockets.js";
import {us_listen_socket_close} from "uWebSockets.js";
import {MicroserviceContext, MicroserviceRequest, MicroserviceStream} from "..";
import {MicroserviceComponentInstance} from "./app";
import {HttpError} from "./http-error";
import {
  ControllerMetadata,
  CONTROLLER_METADATA,
  MethodMetadata,
} from "./metadata";

/** Max amount of bytes on websocket back-pressure before dropping the connection. */
const MAX_WEBSOCKET_BACKPRESSURE_SIZE = 1024; // 1Kb

/** URL query parameters. */
export interface QueryParams {
  [name: string]: string;
}

/** An stream on a uWebSockets server. */
export class MicroservicesHttpServerRequest implements MicroserviceRequest {
  constructor(
    private readonly res: uWS.HttpResponse,
    private readonly req: uWS.HttpRequest,
  ) {
    this.url = this.req.getUrl();
    this.method = this.req.getMethod();
    this.query = this.req.getQuery();
    this.queryParams = URL.parse("/?" + this.query, true).query;
    this.req.forEach((key, value) => {
      this.headers.set(key, value);
    });
    this.remoteAddress = new TextDecoder().decode(res.getRemoteAddressAsText());
  }

  /** The URL including initial /slash   */
  public readonly url: string;

  /** The URL including initial /slash   */
  public readonly method: string;

  /** the raw querystring (the part of URL after ? sign) or empty string.  */
  public readonly query: string;

  /** All query parameters. */
  readonly queryParams: ParsedUrlQuery = {};

  /** All heder values. */
  readonly headers = new Map<string, string>();

  /** The IP address of the remote peer  */
  readonly remoteAddress: string;

  /** Write a header to response. */
  writeResponseHeader(key: string, value: string): void {
    try {
      this.res.writeHeader(key, value);
    } catch (e) {}
  }
}

const emptyReceive = (): void => {
  return;
};

/** An stream on a uWebSockets server. */
export class MicroserviceWebsocketStream implements MicroserviceStream {
  constructor(
    private readonly context: MicroserviceContext,
    private ws: uWS.WebSocket,
    public readonly requestHeader: Map<string, string>,
  ) {
    this.url = ws.url;
  }

  /** Data ingress callback function */
  onReceived: (message: string) => void = emptyReceive;

  /** The request URL. */
  readonly url: string;

  /** Promise that will resolve when the stream is closed. */
  get closed(): Promise<void> {
    return firstValueFrom<void>(this.closedSubject);
  }

  /** Subject to signal closed state. */
  readonly closedSubject = new ReplaySubject<void>(1);

  /** Send a message to the stream. */
  send(msg: string): boolean {
    if (!this.ws.send(msg)) {
      if (this.ws.getBufferedAmount() >= MAX_WEBSOCKET_BACKPRESSURE_SIZE) {
        this.close();
        return false;
      }
    }
    return true;
  }

  /** Close the stream- */
  close(): void {
    try {
      this.ws.close();
    } catch (e) {}
    this.onClose();
  }

  /** Called when the underlying websocket has been closed. */
  onClose(): void {
    this.closedSubject.next();
  }
}

/**
 * HTTP/REST server on top uWebSockets.
 */
export class MicroserviceHttpServer {
  constructor(
    private readonly context: MicroserviceContext,
    private readonly controllers: MicroserviceComponentInstance[],
  ) {}

  /** The uWebSocket App. */
  private wsApp = uWS.App();

  /** The TCP listen socket. */
  private listenSocket?: uWS.us_listen_socket;

  /** Get the server listening port. */
  get listeningPort(): number | undefined {
    return this.listenSocket
      ? uWS.us_socket_local_port(this.listenSocket)
      : undefined;
  }

  /** Register a HTTP POST route. */
  registerPostRoute(
    component: MicroserviceComponentInstance,
    propertyKey: string,
    isStatic: boolean,
    path: string,
    contentType: string,
  ): void {
    const i = path.indexOf("{");
    if (i !== -1) {
      path = path.substr(0, i) + "*";
    }
    this.wsApp.post(path, (res, req) => {
      this.handleRequest(
        component,
        propertyKey,
        isStatic,
        contentType,
        res,
        req,
      );
    });
  }

  /** Register a HTTP PUT route. */
  registerPutRoute(
    component: MicroserviceComponentInstance,
    propertyKey: string,
    isStatic: boolean,
    path: string,
    contentType: string,
  ): void {
    const i = path.indexOf("{");
    if (i !== -1) {
      path = path.substr(0, i) + "*";
    }
    this.wsApp.put(path, (res, req) => {
      this.handleRequest(
        component,
        propertyKey,
        isStatic,
        contentType,
        res,
        req,
      );
    });
  }

  /** Register a HTTP GET route. */
  registerGetRoute(
    component: MicroserviceComponentInstance,
    propertyKey: string,
    isStatic: boolean,
    path: string,
    contentType: string,
  ): void {
    const i = path.indexOf("{");
    if (i !== -1) {
      path = path.substr(0, i) + "*";
    }
    this.wsApp.get(path, (res, req) => {
      this.handleRequest(
        component,
        propertyKey,
        isStatic,
        contentType,
        res,
        req,
      );
    });
  }

  /** Register a HTTP PATCH route. */
  registerPatchRoute(
    component: MicroserviceComponentInstance,
    propertyKey: string,
    isStatic: boolean,
    path: string,
    contentType: string,
  ): void {
    const i = path.indexOf("{");
    if (i !== -1) {
      path = path.substr(0, i) + "*";
    }
    this.wsApp.patch(path, (res, req) => {
      this.handleRequest(
        component,
        propertyKey,
        isStatic,
        contentType,
        res,
        req,
      );
    });
  }

  /** Register a HTTP DELETE route. */
  registerDeleteRoute(
    component: MicroserviceComponentInstance,
    propertyKey: string,
    isStatic: boolean,
    path: string,
    contentType: string,
  ): void {
    const i = path.indexOf("{");
    if (i !== -1) {
      path = path.substr(0, i) + "*";
    }
    this.wsApp.del(path, (res, req) => {
      this.handleRequest(
        component,
        propertyKey,
        isStatic,
        contentType,
        res,
        req,
      );
    });
  }

  /** Register a websocket route. */
  registerWsRoute(
    component: MicroserviceComponentInstance,
    propertyKey: string,
    isStatic: boolean,
    path: string,
  ): void {
    const i = path.indexOf("{");
    if (i !== -1) {
      path = path.substr(0, i) + "*";
    }

    const streams = new Map<uWS.WebSocket, MicroserviceWebsocketStream>();
    const headers = new Map<string, string>();

    this.wsApp.ws(path, {
      compression: uWS.SHARED_COMPRESSOR,
      upgrade: (
        res: uWS.HttpResponse,
        req: uWS.HttpRequest,
        context: uWS.us_socket_context_t,
      ) => {
        const request = new MicroservicesHttpServerRequest(res, req);
        if (!component.running) {
          res.cork(() => {
            res.writeStatus("404 Not Found");
            this.addCORSResponseHeaders(request, res);
            res.end();
          });
          return;
        }
        req.forEach((key, value) => {
          headers.set(key, value);
        });
        res.upgrade(
          {url: req.getUrl()},
          req.getHeader("sec-websocket-key"),
          req.getHeader("sec-websocket-protocol"),
          req.getHeader("sec-websocket-extensions"),
          context,
        );
      },

      open: ws => {
        const stream = new MicroserviceWebsocketStream(
          this.context,
          ws,
          headers,
        );
        streams.set(ws, stream);

        if (isStatic) {
          component.type[propertyKey](stream);
        } else {
          component.instance[propertyKey](stream);
        }
      },

      message: (ws, message, isBinary) => {
        if (isBinary) {
          this.context.error("Binary data on websocket not supported.");
          ws.close();
          return;
        }
        streams.get(ws)?.onReceived(new TextDecoder().decode(message));
      },

      close: ws => {
        const stream = streams.get(ws);
        stream?.onClose();
        streams.delete(ws);
      },
    });
  }

  /** Start the API or callback server. */
  start(port?: number): Promise<void> {
    const portNumber = port ? Number(port) : 0;
    this.context.debug(`Starting HTTP Server on port ${portNumber}`);
    return new Promise<void>((resolve, reject) => {
      this.wsApp.any("/*", (res: uWS.HttpResponse, req: uWS.HttpRequest) => {
        const request = new MicroservicesHttpServerRequest(res, req);
        res.cork(() => {
          const url = req.getUrl();
          this.context.debug(url + " not found.");
          res.writeStatus("404 Not Found");
          this.addCORSResponseHeaders(request, res);
          res.end();
        });
      });

      this.wsApp.options(
        "/*",
        (res: uWS.HttpResponse, req: uWS.HttpRequest) => {
          res.writeStatus("204 No Content");
          res.writeHeader("Access-Control-Allow-Origin", "*");
          res.writeHeader(
            "Access-Control-Allow-Methods",
            "GET, PUT, PATCH, POST, DELETE",
          );
          res.writeHeader(
            "Access-Control-Allow-Headers",
            req.getHeader("access-control-request-headers"),
          );
          res.writeHeader("Access-Control-Max-Age", "86400");
          res.end();
        },
      );

      this.setupRoutes();

      this.wsApp.listen(portNumber, 2, listenSocket => {
        if (listenSocket) {
          this.listenSocket = listenSocket;
          this.context.debug(
            `HTTP Server listening on port ${this.listeningPort}`,
          );
          resolve();
        } else {
          delete this.listenSocket;
          reject(new Error("Failed to create listening socket."));
        }
      });
    });
  }

  /** Stop the server. */
  stop(): void {
    if (this.listenSocket !== undefined) {
      this.context.debug(`HTTP Server on port ${this.listeningPort} stopped`);
      us_listen_socket_close(this.listenSocket);
    }
  }

  /** Setup the routes to controllers.  */
  private setupRoutes(): void {
    this.controllers?.forEach(ctrl => {
      const meta = CONTROLLER_METADATA.get(ctrl.type.name);
      if (meta) {
        meta.methods.forEach(method => {
          this.registerRoute(ctrl, meta, method);
        });
      }
    });
  }

  /** Register route as describe by method metadata. */
  private registerRoute(
    component: MicroserviceComponentInstance,
    metadata: ControllerMetadata,
    method: MethodMetadata,
  ): void {
    const url = metadata.baseUrl + method.path;
    switch (method.method?.toLowerCase()) {
      case "get":
        if (method.websocket) {
          this.registerWsRoute(
            component,
            method.propertyKey,
            method.isStatic,
            url,
          );
        } else {
          this.registerGetRoute(
            component,
            method.propertyKey,
            method.isStatic,
            url,
            method.contentType,
          );
        }
        break;
      case "put":
        this.registerPutRoute(
          component,
          method.propertyKey,
          method.isStatic,
          url,
          method.contentType,
        );
        break;
      case "post":
        this.registerPostRoute(
          component,
          method.propertyKey,
          method.isStatic,
          url,
          method.contentType,
        );
        break;
      case "patch":
        this.registerPatchRoute(
          component,
          method.propertyKey,
          method.isStatic,
          url,
          method.contentType,
        );
        break;
      case "delete":
        this.registerDeleteRoute(
          component,
          method.propertyKey,
          method.isStatic,
          url,
          method.contentType,
        );
        break;
    }
  }

  /** Handle a HTTP request. */
  private handleRequest(
    component: MicroserviceComponentInstance,
    propertyKey: string,
    isStatic: boolean,
    contentType: string,
    res: uWS.HttpResponse,
    req: uWS.HttpRequest,
  ): void {
    res.onAborted(() => {
      res.done = true;
    });

    const startTime = Date.now();
    const request = new MicroservicesHttpServerRequest(res, req);

    if (!component.running) {
      res.cork(() => {
        res.writeStatus("404 Not Found");
        this.addCORSResponseHeaders(request, res);
        res.end();
      });
      return;
    }

    let buffer = "";
    const decoder = new TextDecoder();
    res.onData((chunk, isLast) => {
      buffer += decoder.decode(chunk);
      if (isLast) {
        let data: unknown;
        if (buffer.length) {
          try {
            data = JSON.parse(buffer);
          } catch (error) {
            res.cork(() => {
              res.writeStatus("400 Bad Request");
              this.addCORSResponseHeaders(request, res);
              res.end();
            });
            return;
          }
        }

        let resultCode = 0;
        this.respond(
          () => {
            if (isStatic) {
              return component.type[propertyKey](request, data);
            } else {
              return component.instance[propertyKey](request, data);
            }
          },
          request,
          res,
          contentType,
        )
          .then(code => (resultCode = code))
          .catch(error => (resultCode = error.code))
          .finally(() => {
            const endTime = Date.now();
            resultCode = resultCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
            this.context.debug(
              `HTTP ${request.method} ${request.url} -> ${resultCode} (${
                endTime - startTime
              }ms)`,
            );
          });
      }
    });
  }

  /** Write a success response the uWS.HttpResponse */
  private write(
    req: MicroservicesHttpServerRequest,
    res: uWS.HttpResponse,
    contentType?: string,
    data?: unknown,
  ): void {
    res.cork(() => {
      contentType = contentType ?? "application/json";
      this.addCORSResponseHeaders(req, res);
      res.writeHeader("content-type", contentType);
      if (data) {
        if (contentType === "application/json") {
          res.end(JSON.stringify(data));
        } else {
          res.end(data as string);
        }
      } else {
        res.end();
      }
    });
  }

  /** Write an error response the uWS.HttpResponse */
  private writeError(
    req: MicroservicesHttpServerRequest,
    res: uWS.HttpResponse,
    error: HttpError,
  ): void {
    res.cork(() => {
      const code = error.code ?? HttpStatus.INTERNAL_SERVER_ERROR;
      res.writeStatus(`${code} ${HttpStatus[code]}`);
      this.addCORSResponseHeaders(req, res);
      res.writeHeader("content-type", "application/json");
      if (error.code === undefined) {
        res.end(
          JSON.stringify({
            message: error.message,
            stack: error.stack,
          }),
        );
      } else {
        if (error.message) {
          res.end(
            JSON.stringify({
              message: error.message,
            }),
          );
        } else {
          res.end();
        }
      }
    });
  }

  /** Respond to a request. */
  private async respond(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: () => any,
    req: MicroservicesHttpServerRequest,
    res: uWS.HttpResponse,
    contentType: string,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        const response = func();
        if (response) {
          if (response.then && response.catch) {
            response
              .then((data: unknown) => {
                this.write(req, res, contentType, data);
                resolve(200);
              })
              .catch((error: HttpError) => {
                this.writeError(req, res, error);
                reject(error);
              });
          } else {
            this.write(req, res, contentType, response);
            resolve(200);
          }
        } else {
          this.write(req, res);
          resolve(200);
        }
      } catch (error) {
        this.writeError(req, res, error);
        reject(error);
      }
    });
  }

  /** Add CORS response headers. */
  private addCORSResponseHeaders(
    req: MicroservicesHttpServerRequest,
    res: uWS.HttpResponse,
  ): void {
    const actrlMethod = req.headers.get("access-control-method");
    if (actrlMethod) {
      res.writeHeader("access-control-allow-methods", actrlMethod);
    }

    const actrlHeaders = req.headers.get("access-control-request-headers");
    if (actrlHeaders) {
      res.writeHeader("access-control-allow-headers", actrlHeaders);
    }

    const origin = req.headers.get("origin");
    if (origin) {
      res.writeHeader("access-control-allow-origin", origin);
      res.writeHeader("access-control-allow-credentials", "true");
      res.writeHeader("access-control-expose-headers", "authorization");
    }

    res.writeHeader("access-control-max-age", "86400");
  }
}
