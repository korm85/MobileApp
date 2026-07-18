import React, { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { getSandboxBridgeScript } from '../services/bridgeScript';
import { executeLocalDBWrite } from '../services/StorageService';
import { AppTheme } from '../types';

export function ArtifactRenderer({ htmlContent, theme }: { htmlContent: string; theme: AppTheme }) {
  const webViewRef = useRef<any>(null);
  const source = useMemo(() => {
    const headAdditions = `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none';">
      <style>html,body{margin:0;min-height:100%;background:${theme.background};color:${theme.text};}*{box-sizing:border-box}button,input,select{font:inherit}body{font-family:system-ui,-apple-system,sans-serif;padding:14px}</style>`;
    const trimmed = htmlContent.trim();
    if (/<html[\s>]/i.test(trimmed)) {
      if (/<head[\s>]/i.test(trimmed)) return trimmed.replace(/<head([^>]*)>/i, (match) => `${match}${headAdditions}`);
      return trimmed.replace(/<html([^>]*)>/i, (match) => `${match}<head>${headAdditions}</head>`);
    }
    return `<!doctype html><html><head>${headAdditions}</head><body>${trimmed}</body></html>`;
  }, [htmlContent, theme.background, theme.text]);

  const handleMessage = async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.action !== 'SAVE_DATA') return;
      const result = await executeLocalDBWrite(data.payload);
      const script = `window.LocalDatabaseBridge.onResponse(${JSON.stringify(data.callbackId)}, ${JSON.stringify(result)}); true;`;
      webViewRef.current?.injectJavaScript(script);
    } catch {
      // Generated artifacts cannot access the native database directly.
    }
  };

  return <View style={styles.wrapper}><WebView
    ref={webViewRef}
    source={{ html: source, baseUrl: 'https://local-artifacts.invalid' }}
    injectedJavaScript={getSandboxBridgeScript()}
    onMessage={handleMessage}
    originWhitelist={['https://local-artifacts.invalid']}
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

const styles = StyleSheet.create({ wrapper: { flex: 1, overflow: 'hidden', borderRadius: 20 }, webview: { flex: 1, backgroundColor: 'transparent' } });
