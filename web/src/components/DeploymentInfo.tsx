import { useEffect, useState } from 'react';

interface DeploymentVersion {
  version: string;
  backend_revision: string;
  frontend_revision: string;
  matches: boolean | null;
}

export function DeploymentInfo() {
  const [version, setVersion] = useState<DeploymentVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/version', { signal: controller.signal, cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<DeploymentVersion>;
      })
      .then(setVersion)
      .catch(failure => { if (!controller.signal.aborted) setError(String(failure)); });
    return () => controller.abort();
  }, []);

  const staleBrowser = version && __APP_REVISION__ !== 'unknown' && version.frontend_revision !== 'unknown' && __APP_REVISION__ !== version.frontend_revision;
  return <section className="rounded-2xl bg-[#0d0d0f] p-4 space-y-2 text-neutral-400">
    <h3 className="text-sm font-semibold text-white">Deployment</h3>
    <p>Browser build: {__APP_REVISION__.slice(0, 12)}</p>
    {version && <p>Backend {version.version}: {version.backend_revision.slice(0, 12)} · Web: {version.frontend_revision.slice(0, 12)}</p>}
    {version?.matches === false && <p className="text-amber-400">Backend and web builds differ. Rebuild and redeploy the backend image.</p>}
    {staleBrowser && <p className="text-amber-400">This browser has an older build. Reload to load the deployed version.</p>}
    {error && <p>Version information unavailable: {error}</p>}
  </section>;
}
