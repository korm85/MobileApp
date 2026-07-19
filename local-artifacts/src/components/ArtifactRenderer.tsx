import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import WebView, { WebViewErrorEvent, WebViewHttpErrorEvent, WebViewMessageEvent } from 'react-native-webview';
import { getSandboxBridgeScript } from '../services/bridgeScript';
import { executeLocalDBWrite } from '../services/StorageService';
import { ARTIFACT_RUNTIME } from '../services/artifactRuntime.generated';
import { AppTheme } from '../types';

const PREVIEW_ERROR_SCRIPT = `
(function () {
  function report(message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'PREVIEW_ERROR',
        message: String(message || 'Unknown preview error')
      }));
    } catch (_) {}
  }
  window.addEventListener('error', function (event) {
    report(event.message || 'JavaScript error in artifact');
  });
  window.addEventListener('unhandledrejection', function (event) {
    report(event.reason && event.reason.message ? event.reason.message : event.reason);
  });
})();
true;
`;

function removeConflictingContentSecurityPolicies(html: string) {
  return html.replace(
    /<meta\\b(?=[^>]*\\bhttp-equiv\\s*=\\s*["']?Content-Security-Policy["']?)[^>]*>/gi,
    '',
  );
}

export function ArtifactRenderer({ htmlContent, theme }: { htmlContent: string; theme: AppTheme }) {
  const webViewRef = useRef<any>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const source = useMemo(() => {
    const headAdditions = `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' data:; style-src 'self' 'unsafe-inline' data:; img-src data: blob:; connect-src 'none'; font-src data:; form-action 'none';">
      <style>html,body{margin:0;min-height:100%;background:${theme.background};color:${theme.text};}*{box-sizing:border-box}button,input,select,textarea{font:inherit}body{font-family:system-ui,-apple-system,sans-serif;padding:14px}</style>
      <script>${ARTIFACT_RUNTIME}</script>`;
    const trimmed = removeConflictingContentSecurityPolicies(htmlContent.trim());
    if (/<html[\\s>]/i.test(trimmed)) {
      if (/<head[\\s>]/i.test(trimmed)) return trimmed.replace(/<head([^>]*)>/i, (match) => `${match}${headAdditions}`);
      return trimmed.replace(/<html([^>]*)>/i, (match) => `${match}<head>${headAdditions}</head>`);
    }
    return `<!doctype html><html><head>${headAdditions}</head><body>${trimmed}</body></html>`;
  }, [htmlContent, theme.background, theme.text]);

  const handleMessage = async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.action === 'PREVIEW_ERROR') {
        setPreviewError(data.message);
        return;
      }
      if (data.action !== 'SAVE_DATA') return;
      const result = await executeLocalDBWrite(data.payload);
      const script = `window.LocalDatabaseBridge.onResponse(${JSON.stringify(data.callbackId)}, ${JSON.stringify(result)}); true;`;
      webViewRef.current?.injectJavaScript(script);
    } catch {
      setPreviewError('The artifact sent an invalid message to PocketMind.');
    }
  };

  const handleWebViewError = (event: WebViewErrorEvent) => {
    setPreviewError(event.nativeEvent.description || 'The artifact preview could not be loaded.');
  };

  const handleWebViewHttpError = (event: WebViewHttpErrorEvent) => {
    setPreviewError('Artifact preview HTTP error ' + event.nativeEvent.statusCode + '.');
  };

  if (previewError) {
    return <View style={[styles.error, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.errorTitle, { color: theme.danger }]}>Preview could not render</Text>
      <Text style={[styles.errorText, { color: theme.muted }]}>{previewError}</Text>
      <Text style={[styles.errorHint, { color: theme.muted }]}>The artifact was saved. Go back and open it again after retrying the generation.</Text>
    </View>;
  }

  return <View style={styles.wrapper}><WebView
    ref={webViewRef}
    source={{ html: source, baseUrl: 'https://local-artifacts.invalid' }}
    injectedJavaScriptBeforeContentLoaded={PREVIEW_ERROR_SCRIPT}
    injectedJavaScript={getSandboxBridgeScript()}
    onMessage={handleMessage}
    onError={handleWebViewError}
    onHttpError={handleWebViewHttpError}
    originWhitelist={['*']}
    javaScriptEnabled
    domStorageEnabled
    allowFileAccess={false}
    allowFileAccessFromFileURLs={false}
    allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never"
    setSupportMultipleWindows={false}
    style={styles.webview}
  /></View>;
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, overflow: 'hidden', borderRadius: 20 },
  webview: { flex: 1, backgroundColor: 'transparent' },
  error: { flex: 1, margin: 12, borderWidth: 1, borderRadius: 16, padding: 18, justifyContent: 'center' },
  errorTitle: { fontSize: 18, fontWeight: '800' },
  errorText: { marginTop: 8, fontSize: 13, lineHeight: 19 },
  errorHint: { marginTop: 14, fontSize: 12, lineHeight: 18 },
});
