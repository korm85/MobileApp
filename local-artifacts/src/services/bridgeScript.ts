export const getSandboxBridgeScript = () => `
  (function () {
    if (window.LocalDatabaseBridge) return;
    window.LocalDatabaseBridge = {
      saveData(payload, callback) {
        const callbackId = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        window._localArtifactCallbacks = window._localArtifactCallbacks || {};
        window._localArtifactCallbacks[callbackId] = callback;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          action: 'SAVE_DATA', payload, callbackId
        }));
      },
      onResponse(callbackId, data) {
        const callback = window._localArtifactCallbacks?.[callbackId];
        if (callback) { callback(data); delete window._localArtifactCallbacks[callbackId]; }
      }
    };
  })();
  true;
`;
