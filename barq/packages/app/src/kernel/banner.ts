// Boot banner — printed once by `start()`.

export interface BannerInfo {
	env: string;
	port: number;
	docsPath: string;
	specPath: string;
}

export function printBanner({
	env,
	port,
	docsPath,
	specPath,
}: BannerInfo): void {
	const base = `http://localhost:${port}`;

	console.log(`
⚡ Barq
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓  Server is up and running! (${env})

  ➜  Local:    ${base}
  ➜  Health:   ${base}/health
  ➜  Docs:     ${base}${docsPath}
  ➜  Spec:     ${base}${specPath}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Built for speed. Powered by Barq.
`);
}
