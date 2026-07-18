import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { ArtifactRenderer } from './src/components/ArtifactRenderer';
import { DEFAULT_GENERATION_SETTINGS, DEFAULT_SESSION_ID, MODELS } from './src/constants';
import { useThrottledStream } from './src/hooks/useThrottledStream';
import { createArtifact, parseArtifact } from './src/services/ArtifactParser';
import { LlamaService } from './src/services/LlamaService';
import { downloadModel, getModelPath, modelExists, reattachExistingModelDownloads, subscribeModelDownloads } from './src/services/ModelService';
import { initializeDatabase, loadArtifacts, loadGenerationSettings, loadMessages, saveArtifact, saveGenerationSettings, saveMessage } from './src/services/StorageService';
import { darkTheme, lightTheme } from './src/theme';
import { AppTheme, Artifact, GenerationSettings, Message, ModelState } from './src/types';

type Tab = 'chat' | 'artifacts' | 'models' | 'settings';

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function App() {
  const systemScheme = useColorScheme();
  const theme = systemScheme === 'light' ? lightTheme : darkTheme;
  const [tab, setTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [modelState, setModelState] = useState<ModelState>({});
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [settings, setSettings] = useState<GenerationSettings>({ ...DEFAULT_GENERATION_SETTINGS });
  const [initializing, setInitializing] = useState(true);
  const stream = useThrottledStream(80);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeModelDownloads((update) => {
      if (!mounted) return;
      setModelState((current) => ({
        ...current,
        [update.modelId]: { status: update.status, progress: update.progress, error: update.error },
      }));
    });
    (async () => {
      try {
        await initializeDatabase();
        const [savedMessages, savedArtifacts, savedSettings] = await Promise.all([loadMessages(DEFAULT_SESSION_ID), loadArtifacts(), loadGenerationSettings()]);
        if (!mounted) return;
        setMessages(savedMessages);
        setArtifacts(savedArtifacts);
        setSettings(savedSettings);
        const existing: ModelState = {};
        for (const model of MODELS) {
          if (await modelExists(model.filename)) existing[model.id] = { status: 'ready', progress: 1 };
        }
        if (mounted) setModelState(existing);
        await reattachExistingModelDownloads();
      } finally {
        if (mounted) setInitializing(false);
      }
    })();
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!stream.text) return;
    setMessages((current) => current.map((message) => message.id === streamMessageIdRef.current ? { ...message, content: stream.text } : message));
  }, [stream.text]);

  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const streamMessageIdRef = React.useRef<string | null>(null);
  useEffect(() => { streamMessageIdRef.current = streamMessageId; }, [streamMessageId]);

  const sendMessage = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || streamMessageIdRef.current) return;
    const createdAt = Date.now();
    const userMessage: Message = { id: uid('user'), sessionId: DEFAULT_SESSION_ID, sender: 'user', content: prompt, createdAt };
    setMessages((current) => [...current, userMessage]);
    await saveMessage(userMessage);

    const assistantId = uid('assistant');
    const assistantMessage: Message = { id: assistantId, sessionId: DEFAULT_SESSION_ID, sender: 'assistant', content: '', createdAt: createdAt + 1 };
    setMessages((current) => [...current, assistantMessage]);
    setStreamMessageId(assistantId);
    streamMessageIdRef.current = assistantId;
    stream.reset();

    try {
      if (!loadedModelId) throw new Error('No local model is loaded. Open Models, download a model, and tap Load.');
      const history = messages.slice(-8).map((message) => ({ role: message.sender, content: message.content }));
      const response = await LlamaService.getInstance().generateResponse(prompt, stream.append, history, settings);
      const finalMessage = { ...assistantMessage, content: response };
      setMessages((current) => current.map((message) => message.id === assistantId ? finalMessage : message));
      await saveMessage(finalMessage);
      const html = parseArtifact(response);
      if (html) {
        const artifact = createArtifact(html, assistantId);
        await saveArtifact(artifact);
        setArtifacts((current) => [artifact, ...current]);
        setSelectedArtifact(artifact);
        setTab('artifacts');
      }
    } catch (error) {
      const content = error instanceof Error ? error.message : 'Local generation failed.';
      const errorMessage = { ...assistantMessage, content };
      setMessages((current) => current.map((message) => message.id === assistantId ? errorMessage : message));
      await saveMessage(errorMessage);
    } finally {
      setStreamMessageId(null);
      streamMessageIdRef.current = null;
    }
  };

  const handleDownload = async (modelId: string) => {
    setModelState((current) => ({ ...current, [modelId]: { status: 'downloading', progress: 0 } }));
    try {
      await downloadModel(modelId);
    } catch (error) {
      setModelState((current) => ({ ...current, [modelId]: { status: 'error', progress: 0, error: error instanceof Error ? error.message : 'Download failed' } }));
    }
  };

  const handleLoad = async (modelId: string) => {
    const model = MODELS.find((item) => item.id === modelId);
    if (!model || modelState[modelId]?.status === 'downloading') return;
    setIsLoadingModel(true);
    setModelState((current) => ({ ...current, [modelId]: { ...(current[modelId] ?? { progress: 1 }), status: 'loading' } }));
    try {
      await LlamaService.getInstance().initialize(getModelPath(model.filename), { contextSize: settings.contextSize, threads: settings.threads, gpuLayers: settings.gpuLayers });
      setLoadedModelId(modelId);
      setModelState((current) => ({ ...current, [modelId]: { status: 'loaded', progress: 1 } }));
      setTab('chat');
    } catch (error) {
      setModelState((current) => ({ ...current, [modelId]: { status: 'error', progress: 1, error: error instanceof Error ? error.message : 'Model load failed' } }));
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleSaveSettings = async (next: GenerationSettings) => {
    setSettings(next);
    await saveGenerationSettings(next);
  };

  if (initializing) return <View style={[styles.center, { backgroundColor: theme.background }]}><ActivityIndicator color={theme.accent} /><Text style={[styles.muted, { color: theme.muted, marginTop: 12 }]}>Preparing your private workspace…</Text></View>;

  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
    <StatusBar barStyle={systemScheme === 'light' ? 'dark-content' : 'light-content'} />
    <View style={styles.app}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View>
          <Text style={[styles.brand, { color: theme.text }]}>LocalArtifacts</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>{loadedModelId ? `${MODELS.find((model) => model.id === loadedModelId)?.name} · on device` : 'Private workspace · no cloud'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Open model controls" onPress={() => setTab('settings')} style={[styles.headerControl, { backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.headerControlText, { color: theme.accent }]}>Controls</Text>
          </Pressable>
          <View style={[styles.statusDot, { backgroundColor: loadedModelId ? theme.accent : theme.muted }]} />
        </View>
      </View>

      <View style={styles.content}>
        {tab === 'chat' && <ChatScreen messages={messages} theme={theme} busy={Boolean(streamMessageId)} onSend={sendMessage} onOpenModels={() => setTab('models')} onOpenArtifact={(artifact) => { setSelectedArtifact(artifact); setTab('artifacts'); }} artifacts={artifacts} />}
        {tab === 'artifacts' && <ArtifactsScreen artifacts={artifacts} selected={selectedArtifact} theme={theme} onSelect={setSelectedArtifact} />}
        {tab === 'models' && <ModelsScreen theme={theme} states={modelState} loadedModelId={loadedModelId} loading={isLoadingModel} onDownload={handleDownload} onLoad={handleLoad} />}
        {tab === 'settings' && <SettingsScreen theme={theme} settings={settings} onSave={handleSaveSettings} />}
      </View>

      <View style={[styles.nav, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
        <NavItem icon="⌂" label="Chat" active={tab === 'chat'} theme={theme} onPress={() => setTab('chat')} />
        <NavItem icon="▣" label="Artifacts" active={tab === 'artifacts'} theme={theme} onPress={() => setTab('artifacts')} />
        <NavItem icon="◈" label="Models" active={tab === 'models'} theme={theme} onPress={() => setTab('models')} />
        <NavItem icon="⚙" label="Controls" active={tab === 'settings'} theme={theme} onPress={() => setTab('settings')} />
      </View>
    </View>
  </SafeAreaView>;
}

function ChatScreen({ messages, theme, busy, onSend, onOpenModels, onOpenArtifact, artifacts }: { messages: Message[]; theme: AppTheme; busy: boolean; onSend: (text: string) => Promise<void>; onOpenModels: () => void; onOpenArtifact: (artifact: Artifact) => void; artifacts: Artifact[] }) {
  const [input, setInput] = useState('');
  const canSend = input.trim().length > 0 && !busy;
  const suggestions = ['Track my expenses this month', 'Build a 5/3/1 workout tracker', 'Create a simple game for my girls'];

  const submit = async () => { const value = input; setInput(''); await onSend(value); };
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {messages.length === 0 ? <ScrollView contentContainerStyle={styles.welcome} keyboardShouldPersistTaps="handled">
      <View style={[styles.welcomeMark, { backgroundColor: theme.accentSoft }]}><Text style={{ fontSize: 28 }}>✦</Text></View>
      <Text style={[styles.welcomeTitle, { color: theme.text }]}>What would you like to make?</Text>
      <Text style={[styles.welcomeCopy, { color: theme.muted }]}>Everything stays on your phone. Create useful tools, playful games, and small personal workspaces through conversation.</Text>
      <View style={styles.suggestionWrap}>{suggestions.map((suggestion) => <Pressable key={suggestion} onPress={() => setInput(suggestion)} style={[styles.suggestion, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.suggestionText, { color: theme.text }]}>{suggestion}</Text><Text style={{ color: theme.accent }}>→</Text></Pressable>)}</View>
      <Pressable onPress={onOpenModels} style={[styles.outlineButton, { borderColor: theme.accent }]}><Text style={[styles.outlineButtonText, { color: theme.accent }]}>Set up a local model</Text></Pressable>
    </ScrollView> : <FlatList
      data={messages}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.messageList}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <MessageBubble message={item} theme={theme} artifacts={artifacts} onOpenArtifact={onOpenArtifact} />}
    />}
    <View style={[styles.composerArea, { backgroundColor: theme.background }]}>
      <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TextInput value={input} onChangeText={setInput} placeholder="Ask or describe what to build…" placeholderTextColor={theme.muted} multiline maxLength={6000} style={[styles.input, { color: theme.text }]} onSubmitEditing={submit} />
        <Pressable accessibilityLabel="Send" disabled={!canSend} onPress={submit} style={[styles.sendButton, { backgroundColor: canSend ? theme.accent : theme.surfaceRaised }]}><Text style={{ color: canSend ? '#101114' : theme.muted, fontSize: 20 }}>↑</Text></Pressable>
      </View>
      <Text style={[styles.composerHint, { color: theme.muted }]}>{busy ? 'Generating locally…' : 'Local model · no data leaves this device'}</Text>
    </View>
  </KeyboardAvoidingView>;
}

function MessageBubble({ message, theme, artifacts, onOpenArtifact }: { message: Message; theme: AppTheme; artifacts: Artifact[]; onOpenArtifact: (artifact: Artifact) => void }) {
  const isUser = message.sender === 'user';
  const hasArtifact = !isUser && Boolean(parseArtifact(message.content));
  const artifact = hasArtifact ? artifacts.find((item) => item.sourceMessageId === message.id) : undefined;
  const readable = isUser ? message.content : message.content.replace(/```[\s\S]*?```/g, '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').trim();
  return <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
    <View style={[styles.bubble, { backgroundColor: isUser ? theme.userBubble : theme.assistantBubble, borderColor: theme.border }]}>
      {!!readable && <Text style={[styles.messageText, { color: theme.text }]}>{readable}</Text>}
      {hasArtifact && <Pressable onPress={() => artifact && onOpenArtifact(artifact)} disabled={!artifact} style={[styles.artifactChip, { backgroundColor: theme.accentSoft }]}><Text style={{ color: theme.accent, fontWeight: '700' }}>{artifact ? `Open ${artifact.title}` : 'Artifact created'}</Text><Text style={{ color: theme.accent }}>↗</Text></Pressable>}
      {!message.content && <ActivityIndicator size="small" color={theme.accent} />}
    </View>
  </View>;
}

function ArtifactsScreen({ artifacts, selected, theme, onSelect }: { artifacts: Artifact[]; selected: Artifact | null; theme: AppTheme; onSelect: (artifact: Artifact | null) => void }) {
  if (selected) return <View style={styles.flex}><View style={styles.subHeader}><Pressable onPress={() => onSelect(null)}><Text style={[styles.back, { color: theme.accent }]}>‹ Artifacts</Text></Pressable><Text numberOfLines={1} style={[styles.subHeaderTitle, { color: theme.text }]}>{selected.title}</Text><View style={{ width: 60 }} /></View><ArtifactRenderer htmlContent={selected.html} theme={theme} /></View>;
  return <ScrollView contentContainerStyle={styles.screenPadding}><Text style={[styles.screenTitle, { color: theme.text }]}>Artifacts</Text><Text style={[styles.screenCopy, { color: theme.muted }]}>Your local interactive workspaces live here.</Text>{artifacts.length === 0 ? <EmptyState theme={theme} icon="▣" title="No artifacts yet" copy="Ask the local model to create an expense sheet, workout tracker, dashboard, or game." /> : artifacts.map((artifact) => <Pressable key={artifact.id} onPress={() => onSelect(artifact)} style={[styles.artifactCard, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={[styles.artifactIcon, { backgroundColor: theme.accentSoft }]}><Text style={{ color: theme.accent }}>▦</Text></View><View style={styles.flex}><Text style={[styles.cardTitle, { color: theme.text }]}>{artifact.title}</Text><Text style={[styles.cardMeta, { color: theme.muted }]}>{new Date(artifact.createdAt).toLocaleDateString()}</Text></View><Text style={{ color: theme.muted, fontSize: 24 }}>›</Text></Pressable>)}</ScrollView>;
}

function ModelsScreen({ theme, states, loadedModelId, loading, onDownload, onLoad }: { theme: AppTheme; states: ModelState; loadedModelId: string | null; loading: boolean; onDownload: (id: string) => void; onLoad: (id: string) => void }) {
  return <ScrollView contentContainerStyle={styles.screenPadding}><Text style={[styles.screenTitle, { color: theme.text }]}>Local models</Text><Text style={[styles.screenCopy, { color: theme.muted }]}>Downloads are handed to Android's background downloader, so they can continue while you change screens or turn off the display.</Text><View style={[styles.notice, { backgroundColor: theme.accentSoft }]}><Text style={{ color: theme.accent, fontWeight: '700' }}>Pixel 10a recommended setup</Text><Text style={[styles.noticeCopy, { color: theme.text }]}>Use CPU inference on the Tensor G4/Mali GPU. The current llama.rn OpenCL path targets Adreno devices.</Text></View>{MODELS.map((model) => { const state = states[model.id]; const isLoaded = loadedModelId === model.id; const isBusy = state?.status === 'downloading' || state?.status === 'loading' || loading; return <View key={model.id} style={[styles.modelCard, { backgroundColor: theme.surface, borderColor: isLoaded ? theme.accent : theme.border }]}><View style={styles.modelTop}><View style={styles.flex}><View style={styles.row}><Text style={[styles.cardTitle, { color: theme.text }]}>{model.name}</Text>{model.recommended && <Text style={[styles.recommended, { color: theme.accent, backgroundColor: theme.accentSoft }]}>Recommended</Text>}</View><Text style={[styles.cardMeta, { color: theme.muted }]}>{model.sizeLabel}</Text></View>{isLoaded && <Text style={{ color: theme.accent, fontSize: 22 }}>✓</Text>}</View><Text style={[styles.modelDescription, { color: theme.muted }]}>{model.description}</Text>{state?.status === 'downloading' && <View style={[styles.progressTrack, { backgroundColor: theme.surfaceRaised }]}><View style={[styles.progressFill, { width: `${Math.max(2, state.progress * 100)}%`, backgroundColor: theme.accent }]} /></View>}{state?.error && <Text style={[styles.errorText, { color: theme.danger }]}>{state.error}</Text>}<View style={styles.modelActions}>{state?.status !== 'ready' && state?.status !== 'loaded' && state?.status !== 'loading' && <Pressable disabled={isBusy} onPress={() => onDownload(model.id)} style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>{state?.status === 'error' ? 'Retry download' : 'Download'}</Text></Pressable>}{(state?.status === 'ready' || isLoaded) && <Pressable disabled={isBusy && !isLoaded} onPress={() => onLoad(model.id)} style={[styles.smallButton, { backgroundColor: isLoaded ? theme.accentSoft : theme.accent, borderColor: theme.accent }]}>{state?.status === 'loading' ? <ActivityIndicator size="small" color="#101114" /> : <Text style={{ color: isLoaded ? theme.accent : '#101114', fontWeight: '700' }}>{isLoaded ? 'Reload model' : 'Load model'}</Text>}</Pressable>}</View></View>; })}</ScrollView>;
}

function SettingsScreen({ theme, settings, onSave }: { theme: AppTheme; settings: GenerationSettings; onSave: (settings: GenerationSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  const updateNumber = (key: keyof GenerationSettings, delta: number, min: number, max: number) => {
    const value = Number(draft[key]) as number;
    setDraft((current) => ({ ...current, [key]: Math.min(max, Math.max(min, Number((value + delta).toFixed(2)))) }));
    setSaved(false);
  };

  const save = async () => {
    await onSave(draft);
    setSaved(true);
  };

  return <ScrollView contentContainerStyle={styles.screenPadding} keyboardShouldPersistTaps="handled">
    <Text style={[styles.screenTitle, { color: theme.text }]}>Settings</Text>
    <Text style={[styles.screenCopy, { color: theme.muted }]}>Tune how the on-device model responds. Changes are saved privately on this phone.</Text>

    <Text style={[styles.settingsSection, { color: theme.text }]}>Assistant instructions</Text>
    <Text style={[styles.settingsLabel, { color: theme.muted }]}>System prompt</Text>
    <TextInput value={draft.systemPrompt} onChangeText={(systemPrompt) => { setDraft((current) => ({ ...current, systemPrompt })); setSaved(false); }} placeholder="Leave empty to use the built-in LocalArtifacts prompt" placeholderTextColor={theme.muted} multiline textAlignVertical="top" style={[styles.settingsInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]} />

    <Text style={[styles.settingsSection, { color: theme.text }]}>Generation</Text>
    <SettingStepper theme={theme} title="Temperature" description="Higher values are more varied; lower values are more predictable." value={draft.temperature} step={0.1} decimals={1} onChange={(delta) => updateNumber('temperature', delta, 0, 1.5)} />
    <SettingStepper theme={theme} title="Top P" description="Controls the probability range used for the next token." value={draft.topP} step={0.05} decimals={2} onChange={(delta) => updateNumber('topP', delta, 0.1, 1)} />
    <SettingStepper theme={theme} title="Max output tokens" description="Longer outputs help with artifacts but use more memory and time." value={draft.maxTokens} step={128} decimals={0} onChange={(delta) => updateNumber('maxTokens', delta, 256, 2048)} />
    <Pressable onPress={() => { setDraft((current) => ({ ...current, showThinking: !current.showThinking })); setSaved(false); }} style={[styles.toggleRow, { borderBottomColor: theme.border }]}>
      <View style={styles.flex}><Text style={[styles.cardTitle, { color: theme.text }]}>Thinking / reasoning</Text><Text style={[styles.cardMeta, { color: theme.muted }]}>Preserve visible reasoning when the model's chat template supports it.</Text></View>
      <View style={[styles.toggleTrack, { backgroundColor: draft.showThinking ? theme.accent : theme.surfaceRaised }]}><View style={[styles.toggleThumb, { backgroundColor: draft.showThinking ? '#101114' : theme.muted, alignSelf: draft.showThinking ? 'flex-end' : 'flex-start' }]} /></View>
    </Pressable>

    <Text style={[styles.settingsSection, { color: theme.text }]}>Advanced</Text>
    <Text style={[styles.cardMeta, { color: theme.muted, marginBottom: 4 }]}>Context, threads, and GPU layers apply the next time you load or reload the model.</Text>
    <SettingStepper theme={theme} title="Context size" description="Maximum conversation context. 2,048 is a safer Pixel default." value={draft.contextSize} step={512} decimals={0} onChange={(delta) => updateNumber('contextSize', delta, 1024, 4096)} />
    <SettingStepper theme={theme} title="CPU threads" description="More threads can be faster but leave less headroom for the UI." value={draft.threads} step={1} decimals={0} onChange={(delta) => updateNumber('threads', delta, 1, 6)} />
    <SettingStepper theme={theme} title="GPU layers" description="Keep at 0 on Pixel 10a/Mali unless you have verified a compatible backend." value={draft.gpuLayers} step={1} decimals={0} onChange={(delta) => updateNumber('gpuLayers', delta, 0, 99)} />

    <Pressable onPress={save} style={[styles.saveButton, { backgroundColor: theme.accent }]}><Text style={styles.saveText}>{saved ? 'Saved' : 'Save settings'}</Text></Pressable>
    <View style={[styles.settingRow, { borderBottomColor: theme.border }]}><Text style={[styles.cardTitle, { color: theme.text }]}>Privacy</Text><Text style={[styles.cardMeta, { color: theme.muted }]}>Chat history, artifacts, model files, and saved data are stored on this device. Generated HTML runs with network access disabled.</Text></View>
  </ScrollView>;
}

function SettingStepper({ theme, title, description, value, step, decimals, onChange }: { theme: AppTheme; title: string; description: string; value: number; step: number; decimals: number; onChange: (delta: number) => void }) {
  return <View style={[styles.stepper, { borderBottomColor: theme.border }]}><View style={styles.flex}><Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text><Text style={[styles.cardMeta, { color: theme.muted }]}>{description}</Text></View><View style={styles.stepperControls}><Pressable onPress={() => onChange(-step)} style={[styles.stepperButton, { backgroundColor: theme.surfaceRaised }]}><Text style={{ color: theme.text, fontSize: 20 }}>−</Text></Pressable><Text style={[styles.stepperValue, { color: theme.text }]}>{value.toFixed(decimals)}</Text><Pressable onPress={() => onChange(step)} style={[styles.stepperButton, { backgroundColor: theme.surfaceRaised }]}><Text style={{ color: theme.text, fontSize: 20 }}>+</Text></Pressable></View></View>;
}

function EmptyState({ theme, icon, title, copy }: { theme: AppTheme; icon: string; title: string; copy: string }) { return <View style={styles.empty}><Text style={[styles.emptyIcon, { color: theme.accent }]}>{icon}</Text><Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text><Text style={[styles.screenCopy, { color: theme.muted, textAlign: 'center' }]}>{copy}</Text></View>; }

function NavItem({ icon, label, active, theme, onPress }: { icon: string; label: string; active: boolean; theme: AppTheme; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.navItem}><Text style={{ color: active ? theme.accent : theme.muted, fontSize: 22 }}>{icon}</Text><Text style={[styles.navLabel, { color: active ? theme.accent : theme.muted }]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  safe: { flex: 1 }, app: { flex: 1 }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { minHeight: 66, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 }, headerControl: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10 }, headerControlText: { fontSize: 12, fontWeight: '800' },
  brand: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }, subtitle: { fontSize: 12, marginTop: 2 }, statusDot: { width: 9, height: 9, borderRadius: 5 }, content: { flex: 1 }, nav: { height: 70, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8 }, navItem: { alignItems: 'center', minWidth: 70 }, navLabel: { fontSize: 11, marginTop: 2 },
  welcome: { padding: 24, alignItems: 'center', justifyContent: 'center', flexGrow: 1 }, welcomeMark: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, welcomeTitle: { fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: -0.7 }, welcomeCopy: { fontSize: 15, lineHeight: 22, maxWidth: 360, textAlign: 'center', marginTop: 10 }, suggestionWrap: { alignSelf: 'stretch', marginTop: 26, gap: 10 }, suggestion: { borderWidth: 1, borderRadius: 15, padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, suggestionText: { fontSize: 14, flex: 1 }, outlineButton: { marginTop: 20, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 }, outlineButtonText: { fontWeight: '700' },
  messageList: { padding: 16, paddingBottom: 24 }, messageRow: { marginVertical: 5, flexDirection: 'row' }, userRow: { justifyContent: 'flex-end' }, assistantRow: { justifyContent: 'flex-start' }, bubble: { maxWidth: '88%', padding: 14, borderRadius: 18, borderWidth: 1 }, messageText: { fontSize: 16, lineHeight: 23 }, artifactChip: { marginTop: 12, borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, composerArea: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 7 }, composer: { minHeight: 54, maxHeight: 150, borderWidth: 1, borderRadius: 20, padding: 6, flexDirection: 'row', alignItems: 'flex-end' }, input: { flex: 1, fontSize: 16, maxHeight: 130, paddingHorizontal: 10, paddingVertical: 8 }, sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, composerHint: { textAlign: 'center', fontSize: 10, marginTop: 5 },
  screenPadding: { padding: 18, paddingBottom: 30 }, screenTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.7 }, screenCopy: { fontSize: 14, lineHeight: 20, marginTop: 6 }, artifactCard: { marginTop: 12, padding: 14, borderWidth: 1, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 12 }, artifactIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, cardTitle: { fontSize: 15, fontWeight: '700' }, cardMeta: { fontSize: 12, marginTop: 4 }, subHeader: { height: 54, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { fontSize: 15, fontWeight: '700', width: 70 }, subHeaderTitle: { fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },
  modelCard: { marginTop: 14, padding: 16, borderWidth: 1, borderRadius: 18 }, modelTop: { flexDirection: 'row', alignItems: 'flex-start' }, row: { flexDirection: 'row', alignItems: 'center', gap: 7 }, recommended: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 }, modelDescription: { fontSize: 13, lineHeight: 19, marginTop: 9 }, notice: { padding: 14, borderRadius: 15, marginTop: 18 }, noticeCopy: { fontSize: 12, lineHeight: 18, marginTop: 5 }, progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 14 }, progressFill: { height: 6, borderRadius: 3 }, modelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 }, smallButton: { minWidth: 100, minHeight: 40, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, errorText: { fontSize: 11, marginTop: 10 },
  settingRow: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth }, settingsSection: { fontSize: 17, fontWeight: '800', marginTop: 24, marginBottom: 10 }, settingsLabel: { fontSize: 13, fontWeight: '700', marginBottom: 7 }, settingsInput: { minHeight: 130, borderWidth: 1, borderRadius: 14, padding: 12, fontSize: 14, lineHeight: 20 }, stepper: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 }, stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 7 }, stepperButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, stepperValue: { minWidth: 48, textAlign: 'center', fontSize: 14, fontWeight: '700' }, toggleRow: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 }, toggleTrack: { width: 50, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' }, toggleThumb: { width: 24, height: 24, borderRadius: 12 }, saveButton: { minHeight: 48, marginTop: 24, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#101114', fontSize: 15, fontWeight: '800' }, empty: { alignItems: 'center', paddingHorizontal: 20, marginTop: 90 }, emptyIcon: { fontSize: 42, marginBottom: 14 }, muted: { fontSize: 14 },
});
