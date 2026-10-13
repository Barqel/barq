import { Gauge, type Registry } from "./registry";

export function collectDefaultMetrics(registry: Registry): () => void {
	const processCpu = registry.register(
		new Gauge(
			"process_cpu_seconds_total",
			"Total user and system CPU time spent in seconds.",
		),
	);
	const processMemRss = registry.register(
		new Gauge(
			"process_resident_memory_bytes",
			"Resident memory size in bytes.",
		),
	);
	const processMemHeap = registry.register(
		new Gauge(
			"nodejs_heap_size_total_bytes",
			"Process heap size from Node.js in bytes.",
		),
	);
	const processMemHeapUsed = registry.register(
		new Gauge(
			"nodejs_heap_size_used_bytes",
			"Process heap size used from Node.js in bytes.",
		),
	);

	return () => {
		const usage = process.memoryUsage();
		processMemRss.set({}, usage.rss);
		processMemHeap.set({}, usage.heapTotal);
		processMemHeapUsed.set({}, usage.heapUsed);

		if (typeof process.cpuUsage === "function") {
			const cpu = process.cpuUsage();
			processCpu.set({}, (cpu.user + cpu.system) / 1e6);
		} else {
			processCpu.set({}, process.uptime());
		}
	};
}
