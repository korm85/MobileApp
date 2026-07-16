import React, {useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator, Alert, Button, SafeAreaView, ScrollView, Share,
  StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View,
} from 'react-native';
import {pick, types, isErrorWithCode, errorCodes} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import Markdown from 'react-native-markdown-display';
import {WebView} from 'react-native-webview';
import {initLlama, type LlamaContext} from 'llama.rn';

type Message = {role: 'user' | 'assistant'; content: string};
type Artifact = {type: string; body: string};
const STOP = ['</s>', '<|end|>', '<|eot_id|>', '<|end_of_text|>', '<|im_end|>', '<|EOT|>', '<|endoftext|>'];

function extractArtifacts(text: string): Artifact[] {
  const result: Artifact[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) result.push({type: (match[1] || 'text').toLowerCase(), body: match[2]});
  return result;
}

export default function App() {
  const dark = useColorScheme() === 'dark';
  const colors = useMemo(() => ({
    bg: dark ? '#121214' : '#FAF9FC', card: dark ? '#202024' : '#FFFFFF',
    text: dark ? '#F5F4F8' : '#1F1D23', muted: dark ? '#B8B5BE' : '#65616C',
    accent: dark ? '#D0BCFF' : '#6750A4', bubble: dark ? '#4C3A70' : '#E8DEFF',
  }), [dark]);

  const context = useRef<LlamaContext | null>(null);
  const [modelName, setModelName] = useState('Choose Ternary-Bonsai-8B-Q2_0_g64.gguf');
  const [modelPath, setModelPath] = useState('');
  const [status, setStatus] = useState('Runs privately on this phone');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [artifact, setArtifact] = useState<Artifact | null>(null);

  const chooseModel = async () => {
    try {
      setStatus('Copying model into app storage…');
      const [file] = await pick({type: [types.allFiles], allowMultiSelection: false});
      const safeName = (file.name || 'model.gguf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const target = `${RNFS.CachesDirectoryPath}/${safeName}`;
      if (await RNFS.exists(target)) await RNFS.unlink(target);
      await RNFS.copyFile(file.uri, target);
      const stat = await RNFS.stat(target);
      setModelPath(`file://${target}`);
      setModelName(file.name || safeName);
      setStatus(`${(Number(stat.size) / 1024 / 1024 / 1024).toFixed(2)} GB copied locally and ready to load`);
    } catch (error: unknown) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
        setStatus(modelPath ? 'Model ready to load' : 'Runs privately on this phone');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatus('Model copy failed');
      Alert.alert('Model selection failed', message);
    }
  };

  const loadModel = async () => {
    if (!modelPath) { await chooseModel(); return; }
    setLoading(true); setStatus('Loading model into memory…');
    try {
      if (context.current) await context.current.release();
      context.current = await initLlama({
        model: modelPath, n_ctx: 2048, n_batch: 128, n_ubatch: 128,
        n_threads: 4, n_threads_batch: 4, n_gpu_layers: 0,
        use_mmap: true, use_mlock: false, flash_attn_type: 'disabled',
      });
      setStatus('Loaded locally • 2048 context • 4 CPU threads');
    } catch (error: unknown) {
      context.current = null; setStatus('Load failed');
      Alert.alert('PocketMind', error instanceof Error ? error.message : String(error));
    } finally { setLoading(false); }
  };

  const send = async () => {
    const value = input.trim();
    if (!value || !context.current || generating) return;
    setInput('');
    setMessages(prev => [...prev, {role: 'user', content: value}, {role: 'assistant', content: ''}]);
    setGenerating(true);
    try {
      let streamed = '';
      const history = [...messages, {role: 'user' as const, content: value}];
      const result = await context.current.completion({
        messages: [{role: 'system', content: 'You are a direct helpful assistant. Use clean Markdown. Put complete code, HTML, SVG, JSON, tables, or documents in fenced code blocks so the app can show them as artifacts.'}, ...history],
        n_predict: 512, temperature: 0.65, top_k: 40, top_p: 0.9,
        repeat_penalty: 1.1, stop: STOP,
      }, data => {
        streamed += data.token;
        setMessages(prev => { const next = [...prev]; next[next.length - 1] = {role: 'assistant', content: streamed}; return next; });
      });
      if (!streamed && result.text) setMessages(prev => { const next = [...prev]; next[next.length - 1] = {role: 'assistant', content: result.text}; return next; });
    } catch (error: unknown) {
      Alert.alert('Generation failed', error instanceof Error ? error.message : String(error));
    } finally { setGenerating(false); }
  };

  const stop = async () => { try { await context.current?.stopCompletion(); } finally { setGenerating(false); } };
  const styles = makeStyles(colors);

  return <SafeAreaView style={styles.safe}>
    <View style={styles.root}>
      <View style={styles.header}><Text style={styles.title}>PocketMind</Text><Button title="New" onPress={() => setMessages([])} color={colors.accent}/></View>
      <View style={styles.modelCard}>
        <View style={styles.modelRow}><View style={{flex: 1}}><Text style={styles.modelName}>{modelName}</Text><Text style={styles.muted}>{status}</Text></View><Button title="Choose" onPress={chooseModel} color={colors.accent}/></View>
        <TouchableOpacity style={styles.loadButton} onPress={loadModel} disabled={loading}>{loading ? <ActivityIndicator color="#fff"/> : <Text style={styles.loadText}>{context.current ? 'Reload model' : 'Load model'}</Text>}</TouchableOpacity>
      </View>
      <ScrollView style={styles.chat} contentContainerStyle={{paddingVertical: 16}}>
        {messages.length === 0 && <View style={styles.assistantBubble}><Text style={styles.text}>Choose the local GGUF model, load it, then chat fully offline.</Text></View>}
        {messages.map((message, index) => {
          const artifacts = message.role === 'assistant' ? extractArtifacts(message.content) : [];
          return <View key={index} style={message.role === 'user' ? styles.userBubble : styles.assistantBubble}>
            {message.role === 'assistant' ? <Markdown style={{body: {color: colors.text, fontSize: 16, lineHeight: 24}, code_block: {backgroundColor: colors.bg, color: colors.text}}}>{message.content}</Markdown> : <Text style={styles.text}>{message.content}</Text>}
            {artifacts.map((item, i) => <TouchableOpacity key={i} style={styles.artifactButton} onPress={() => setArtifact(item)}><Text style={styles.artifactText}>Open {item.type || 'artifact'}</Text></TouchableOpacity>)}
          </View>;
        })}
      </ScrollView>
      <View style={styles.composer}><TextInput style={styles.input} placeholder="Message your local model" placeholderTextColor={colors.muted} value={input} onChangeText={setInput} multiline editable={!generating}/><Button title={generating ? 'Stop' : 'Send'} onPress={generating ? stop : send} color={colors.accent}/></View>
    </View>
    {artifact && <View style={styles.overlay}><View style={styles.preview}>
      <View style={styles.previewHeader}><Text style={styles.modelName}>Artifact preview</Text><Button title="Close" onPress={() => setArtifact(null)} color={colors.accent}/></View>
      {(artifact.type === 'html' || artifact.type === 'svg') ? <WebView originWhitelist={['about:blank']} javaScriptEnabled={false} source={{html: artifact.type === 'svg' ? `<html><body>${artifact.body}</body></html>` : artifact.body}} style={{flex: 1}}/> : <ScrollView style={{flex: 1}}><Text selectable style={styles.code}>{artifact.body}</Text></ScrollView>}
      <Button title="Share" onPress={() => Share.share({message: artifact.body})} color={colors.accent}/>
    </View></View>}
  </SafeAreaView>;
}

function makeStyles(c: any) { return StyleSheet.create({
  safe: {flex: 1, backgroundColor: c.bg}, root: {flex: 1, paddingHorizontal: 16, backgroundColor: c.bg},
  header: {height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, title: {fontSize: 23, fontWeight: '700', color: c.text},
  modelCard: {backgroundColor: c.card, borderRadius: 22, padding: 16}, modelRow: {flexDirection: 'row', alignItems: 'center'}, modelName: {fontSize: 17, fontWeight: '700', color: c.text}, muted: {color: c.muted, marginTop: 4},
  loadButton: {height: 50, borderRadius: 18, marginTop: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent}, loadText: {color: '#fff', fontWeight: '700', fontSize: 16},
  chat: {flex: 1}, assistantBubble: {alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: c.card, borderRadius: 20, padding: 14, marginVertical: 6}, userBubble: {alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: c.bubble, borderRadius: 20, padding: 14, marginVertical: 6}, text: {fontSize: 16, lineHeight: 24, color: c.text},
  composer: {flexDirection: 'row', alignItems: 'flex-end', backgroundColor: c.card, borderRadius: 28, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8}, input: {flex: 1, minHeight: 44, maxHeight: 130, color: c.text, fontSize: 16},
  artifactButton: {marginTop: 10, borderRadius: 14, padding: 12, backgroundColor: c.bg}, artifactText: {color: c.accent, fontWeight: '700'},
  overlay: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#0009', padding: 18, justifyContent: 'center'}, preview: {height: '88%', borderRadius: 20, backgroundColor: c.card, padding: 14}, previewHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, code: {fontFamily: 'monospace', fontSize: 14, color: c.text, paddingVertical: 12},
});}
