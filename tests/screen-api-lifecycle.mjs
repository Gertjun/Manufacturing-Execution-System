// Alleen voor Linux/Chrome E2E-testprocessen; geen applicatiecode.
// De API is een rechtstreeks Node-kindproces (geen npm/tsx CLI-wrapper).
// SIGTERM naar de eigen process group; wacht expliciet op de exit van het API-proces.
// Databasequiescentie wordt aanvullend door test_schermen.sh gecontroleerd.
export async function stopTestApi(api, timeoutMs = 10000) {
  if (!api.pid) throw new Error("Test-API heeft geen proces-id");
  if (api.exitCode !== null || api.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      api.removeListener("exit", onExit);
      api.removeListener("error", onError);
      error ? reject(error) : resolve();
    };
    const onExit = () => finish();
    const onError = error => finish(error);
    api.once("exit", onExit);
    api.once("error", onError);
    timer = setTimeout(() => {
      // Geen stille retry: geforceerde cleanup is een testfout.
      try { process.kill(-api.pid, "SIGKILL"); } catch (e) {
        if (e.code !== "ESRCH") return finish(e);
      }
      finish(new Error("Test-API niet binnen " + timeoutMs + " ms afgesloten (pid " + api.pid + ")"));
    }, timeoutMs);
    try { process.kill(-api.pid, "SIGTERM"); } catch (e) {
      if (e.code !== "ESRCH") finish(e);
      // ESRCH: exit-event kan nog onderweg zijn; wacht op dat event.
    }
  });
}
