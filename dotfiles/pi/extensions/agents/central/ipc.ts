/** Newline-framed local requests; bounded buffers and no background polling. */
import * as net from "node:net";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { runtimeHome } from "./database.ts";
export const socketPath = (home = runtimeHome()) => path.join(home, "runtime.sock");
export interface Frame { request?: string; op?: string; args?: any; result?: any; error?: string; event?: string; data?: any }
export function frames(socket: net.Socket, receive: (frame: Frame) => void) {
	let buffer = "";
	socket.setEncoding("utf8");
	socket.on("data", chunk => {
		buffer += chunk;
		if (buffer.length > 2 * 1024 * 1024) return socket.destroy(new Error("Runtime frame too large"));
		let end: number;
		while ((end = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
			try { receive(JSON.parse(line)); } catch { socket.destroy(new Error("Invalid runtime frame")); return; }
		}
	});
}
export function send(socket: net.Socket, frame: Frame) {
	if (socket.destroyed) throw new Error("Runtime connection closed");
	if (socket.writableLength > 2 * 1024 * 1024) { socket.destroy(); throw new Error("Runtime subscriber too slow"); }
	socket.write(JSON.stringify(frame, (_key, value) => value === undefined ? null : value) + "\n");
}
export class RuntimeClient extends EventEmitter {
	private socket?: net.Socket;
	private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	async connect(home = runtimeHome()): Promise<void> {
		const socket = net.createConnection(socketPath(home)); this.socket = socket;
		frames(socket, frame => {
			if (frame.event) { this.emit(frame.event, frame.data); return; }
			const waiter = frame.request && this.pending.get(frame.request);
			if (waiter) { this.pending.delete(frame.request!); frame.error ? waiter.reject(new Error(frame.error)) : waiter.resolve(frame.result); }
		});
		socket.on("error", () => {});
		socket.on("close", () => {
			for (const waiter of this.pending.values()) waiter.reject(new Error("Runtime disconnected"));
			this.pending.clear(); this.emit("disconnect");
		});
		await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
	}
	request(op: string, args: any = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const request = crypto.randomUUID(); this.pending.set(request, { resolve, reject });
			try { if (!this.socket) throw new Error("Runtime not connected"); send(this.socket, { request, op, args }); }
			catch (error) { this.pending.delete(request); reject(error); }
		});
	}
	/** Inherit this connected lease as fd3 in dtach; never end()/shutdown() while it lives. */
	leaseSocket(): net.Socket { if (!this.socket) throw new Error("Not connected"); return this.socket; }
	close() { this.socket?.destroy(); }
}
