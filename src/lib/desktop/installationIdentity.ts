let installationIdPromise: Promise<string> | null = null;

export async function getCurrentInstallationId(): Promise<string> {
  if (typeof window === 'undefined' || !window.dropdexDesktop?.isElectron) {
    throw new Error('DropDex installation identity requires the desktop runtime.');
  }
  if (!installationIdPromise) {
    installationIdPromise = window.dropdexDesktop.getInstallationId().then((value) => {
      const installationId = value.trim();
      if (!installationId) throw new Error('DropDex installation identity is unavailable.');
      return installationId;
    }).catch((error) => {
      installationIdPromise = null;
      throw error;
    });
  }
  return installationIdPromise;
}

export function resetInstallationIdForTests(): void {
  installationIdPromise = null;
}
