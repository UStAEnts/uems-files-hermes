import { UserMessage } from "@uems/uemscommlib";
import { RabbitNetworkHandler } from "@uems/micro-builder";

interface MockBrokerInterface<R, D, U, C, M> {
    on(name: 'query', callback: (message: R, send: (data: any) => void) => void, routingKey: string): void;

    on(name: 'delete', callback: (message: D, send: (data: any) => void) => void, routingKey: string): void;

    on(name: 'update', callback: (message: U, send: (data: any) => void) => void, routingKey: string): void;

    on(name: 'create', callback: (message: C, send: (data: any) => void) => void, routingKey: string): void;

    on(name: 'any', callback: (message: M, send: (data: any) => void) => void, routingKey: string): void;
}

export class BindingBroker<R, D, U, C, M> implements MockBrokerInterface<R, D, U, C, M> {

    private _listeners: {
        'query': ((message: R, send: (data: any) => void) => void)[],
        'delete': ((message: D, send: (data: any) => void) => void)[],
        'update': ((message: U, send: (data: any) => void) => void)[],
        'create': ((message: C, send: (data: any) => void) => void)[],
        'any': ((message: M, send: (data: any) => void) => void)[],
    } = {
        'query': [],
        'delete': [],
        'update': [],
        'create': [],
        'any': [],
    }

    on(name: "query", callback: (message: R, send: (data: any) => void) => void, routingKey: string): void;
    on(name: "delete", callback: (message: D, send: (data: any) => void) => void, routingKey: string): void;
    on(name: "update", callback: (message: U, send: (data: any) => void) => void, routingKey: string): void;
    on(name: "create", callback: (message: C, send: (data: any) => void) => void, routingKey: string): void;
    on(name: "any", callback: (message: M, send: (data: any) => void) => void, routingKey: string): void;
    on(name: "query" | "delete" | "update" | "create" | "any", callback: ((message: R, send: (data: any) => void) => void) | ((message: D, send: (data: any) => void) => void) | ((message: U, send: (data: any) => void) => void) | ((message: C, send: (data: any) => void) => void) | ((message: M, send: (data: any) => void) => void), routingKey: string): void {
        // @ts-ignore
        this._listeners[name].push(callback);
    }

    emit(name: "query", message: R, routingKey: string, send: (data: any) => void): void;
    emit(name: "delete", message: D, routingKey: string, send: (data: any) => void): void;
    emit(name: "update", message: U, routingKey: string, send: (data: any) => void): void;
    emit(name: "create", message: C, routingKey: string, send: (data: any) => void): void;
    emit(name: "any", message: M, routingKey: string, send: (data: any) => void): void;
    emit(name: "query" | 'delete' | 'update' | 'create' | 'any', message: R | D | U | C | M, routingKey: string, send: (data: any) => void) {
        // @ts-ignore
        this._listeners[name].forEach((e) => e(message, send, routingKey));
        if (name !== 'any') {
            // @ts-ignore
            this._listeners.any.forEach((e) => e(message, send, routingKey));
        }
    }

    promiseEmit(name: "query", message: R, routingKey: string): Promise<any>;
    promiseEmit(name: "delete", message: D, routingKey: string): Promise<any>;
    promiseEmit(name: "update", message: U, routingKey: string): Promise<any>;
    promiseEmit(name: "create", message: C, routingKey: string): Promise<any>;
    promiseEmit(name: "any", message: M, routingKey: string): Promise<any>;
    promiseEmit(name: "query" | 'delete' | 'update' | 'create' | 'any', message: R | D | U | C | M, routingKey: string): Promise<any> {
        return new Promise((resolve, reject) => {
            let timeout = setTimeout(() => {
                reject('timed out');
            }, 5000);

            let innerResolve = (data: any) => {
                clearTimeout(timeout);
                resolve(data);
            }

            // @ts-ignore
            this._listeners[name].forEach((e) => e(message, innerResolve, routingKey));
            if (name !== 'any') {
                // @ts-ignore
                this._listeners.any.forEach((e) => e(message, innerResolve, routingKey));
            }
        })
    }


    clear() {
        this._listeners.query = [];
        this._listeners.delete = [];
        this._listeners.update = [];
        this._listeners.create = [];
        this._listeners.any = [];
    }

}

export const makeBindingBroker = () => new BindingBroker() as unknown as RabbitNetworkHandler<any, any, any, any, any, any>;
