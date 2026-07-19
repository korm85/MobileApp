import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ArtifactRenderer } from './src/components/ArtifactRenderer';
import { DEFAULT_CHAT_CONTROLS, DEFAULT_GENERATION_SETTINGS, DEFAULT_SESSION_ID, MODELS } from './src/constants';
import { useThrottledStream } from './src/hooks/useThrottledStream';
import { ArtifactStreamDetector, createArtifact, parseArtifactProtocol, parseArtifactResponse, stripArtifactProtocol } from './src/services/ArtifactParser';
import { LlamaService } from './src/services/LlamaService';
import { downloadModel, getModelPath, modelDefinitionReady, reattachExistingModelDownloads, subscribeModelDownloads } from './src/services/ModelService';
import { createSession, initializeDatabase, loadActiveSessionId, loadArtifacts, loadGenerationSettings, loadMessages, loadSessions, loadTavilyApiKey, saveActiveSessionId, saveArtifact, saveGenerationSettings, saveMessage, saveTavilyApiKey } from './src/services/StorageService';
import { formatSearchContext, formatSourcesForMessage, searchWeb, WebSearchResponse } from './src/services/WebSearchService';
import { darkTheme, lightTheme } from './src/theme';
import { AppTheme, Artifact, ChatSession, GenerationSettings, MediaAttachment, Message, ModelState } from './src/types';

type Tab = 'chat' | 'artifacts' | 'models' | 'settings';
const uid = (prefix: string) => prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}

async function persistPickedMedia(uri: string, kind: MediaAttachment['kind'], mimeType: string, name: string, size?: number): Promise<MediaAttachment> {
  const directory = FileSystem.documentDirectory + 'attachments/';
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : kind === 'image' ? '.jpg' : '.wav';
  const destination = directory + uid('media') + extension;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return { id: uid('attachment'), kind, uri: destination, mimeType, name, size };
}

function AppContent() {
  const systemScheme = useColorScheme();
  const theme = systemScheme === 'light' ? lightTheme : darkTheme;
  const [tab, setTab] = useState<Tab>('chat');
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_SESSION_ID);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [modelState, setModelState] = useState<ModelState>({});
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [settings, setSettings] = useState<GenerationSettings>({ ...DEFAULT_GENERATION_SETTINGS });
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<MediaAttachment[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const streamMessageIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const artifactDetectorRef = useRef(new ArtifactStreamDetector());
  const activeArtifactRef = useRef<Artifact | null>(null);
  const stream = useThrottledStream(80);

  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId), [sessions, activeSessionId]);
  const fallbackSession: ChatSession = {
    id: activeSessionId,
    title: 'New conversation',
    createdAt: Date.now(),
    ...DEFAULT_CHAT_CONTROLS,
  };
  const chatSession = activeSession || fallbackSession;

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeModelDownloads((update) => {
      if (!mounted) return;
      setModelState((current) => ({ ...current, [update.modelId]: { status: update.status, progress: update.progress, error: update.error } }));
    });
    (async () => {
      try {
        await initializeDatabase();
        const loaded = await Promise.all([loadGenerationSettings(), loadTavilyApiKey(), loadSessions(), loadActiveSessionId()]);
        const savedSettings = loaded[0];
        const savedTavilyApiKey = loaded[1];
        const savedSessions = loaded[2];
        const savedActiveSessionId = loaded[3];
        if (!mounted) return;
        const sessionId = savedSessions.some((session) => session.id === savedActiveSessionId) ? savedActiveSessionId : DEFAULT_SESSION_ID;
        const savedData = await Promise.all([loadMessages(sessionId), loadArtifacts(sessionId)]);
        setActiveSessionId(sessionId);
        setSessions(savedSessions);
        setMessages(savedData[0]);
        setArtifacts(savedData[1]);
        setSettings(savedSettings);
        setTavilyApiKey(savedTavilyApiKey);
        const existing: ModelState = {};
        for (const model of MODELS) {
          if (await modelDefinitionReady(model)) existing[model.id] = { status: 'ready', progress: 1 };
        }
        setModelState(existing);
        await reattachExistingModelDownloads();
      } catch (error) {
        setInitializationError(error instanceof Error ? error.message : 'Could not open the local workspace.');
      } finally {
        if (mounted) setInitializing(false);
      }
    })();
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!stream.text) return;
    setMessages((current) => current.map((message) => message.id === streamMessageIdRef.current ? { ...message, content: stream.text } : message));
  }, [stream.text]);

  const updateChatSession = async (patch: Partial<ChatSession>) => {
    const current = sessions.find((session) => session.id === activeSessionId) || fallbackSession;
    const next = { ...current, ...patch };
    setSessions((all) => all.some((session) => session.id === next.id) ? all.map((session) => session.id === next.id ? next : session) : [next, ...all]);
    await createSession(next);
  };

  const sendMessage = async (rawText: string, media: MediaAttachment[] = []) => {
    const prompt = rawText.trim();
    if ((!prompt && media.length === 0) || streamMessageIdRef.current) return;
    const sessionId = activeSessionId;
    const assistantId = uid('assistant');
    const createdAt = Date.now();
    const userMessage: Message = { id: uid('user'), sessionId, sender: 'user', content: prompt, createdAt, attachments: media.length ? media : undefined };
    const assistantMessage: Message = { id: assistantId, sessionId, sender: 'assistant', content: '', createdAt: createdAt + 1 };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    await saveMessage(userMessage);
    setStreamMessageId(assistantId);
    streamMessageIdRef.current = assistantId;
    stopRequestedRef.current = false;
    stream.reset();
    artifactDetectorRef.current.reset();
    activeArtifactRef.current = null;

    try {
      if (!loadedModelId) throw new Error('No local model is loaded. Open Models, download a model, and tap Load.');
      const history = messages.slice(-8).map((message) => ({ role: message.sender, content: message.content, attachments: message.attachments }));
      let generationPrompt = prompt || 'Please describe the attached media.';
      let searchResponse: WebSearchResponse | null = null;
      if (chatSession.webSearchEnabled && prompt) {
        searchResponse = await searchWeb(prompt, chatSession.webSearchDepth, tavilyApiKey);
        if (searchResponse.results.length > 0) generationPrompt = prompt + '\n\n' + formatSearchContext(searchResponse);
      }
      const publishArtifact = async (parsed: ReturnType<typeof parseArtifactProtocol>) => {
        if (!parsed || activeArtifactRef.current) return activeArtifactRef.current;
        const artifact = createArtifact(parsed, sessionId, assistantId);
        activeArtifactRef.current = artifact;
        setArtifacts((current) => [artifact, ...current]);
        setSelectedArtifact(artifact);
        setTab('artifacts');
        try { await saveArtifact(artifact); } catch (error) { console.warn('Artifact persistence failed', error); }
        return artifact;
      };
      let streamedResponse = '';
      const onToken = (token: string) => {
        streamedResponse += token;
        stream.append(token);
        if (settings.responseMode !== 'chat') {
          const parsed = artifactDetectorRef.current.append(token);
          if (parsed) void publishArtifact(parsed);
        }
      };
      const response = await LlamaService.getInstance().generateResponse(generationPrompt, onToken, history as any, settings, chatSession, media);
      const sources = searchResponse ? formatSourcesForMessage(searchResponse) : '';
      const allowRawCanvas = settings.responseMode === 'canvas';
      const parsed = settings.responseMode !== 'chat'
        ? (parseArtifactResponse(response, allowRawCanvas) || parseArtifactResponse(streamedResponse, allowRawCanvas))
        : null;
      if (parsed) await publishArtifact(parsed);
      const readableResponse = parsed ? '' : stripArtifactProtocol(response).trim();
      const finalMessage: Message = { ...assistantMessage, content: (readableResponse || (parsed ? 'Created ' + parsed.title + '.' : 'Done.')) + sources };
      setMessages((current) => current.map((message) => message.id === assistantId ? finalMessage : message));
      await saveMessage(finalMessage);
    } catch (error) {
      const content = stopRequestedRef.current ? 'Generation stopped.' : error instanceof Error ? error.message : 'Local generation failed.';
      const errorMessage: Message = { ...assistantMessage, content };
      setMessages((current) => current.map((message) => message.id === assistantId ? errorMessage : message));
      await saveMessage(errorMessage);
    } finally {
      setStreamMessageId(null);
      streamMessageIdRef.current = null;
      stopRequestedRef.current = false;
    }
  };

  const stopGeneration = async () => {
    if (!streamMessageIdRef.current) return;
    stopRequestedRef.current = true;
    await LlamaService.getInstance().stopGeneration();
  };

  const retryMessage = async (messageId: string) => {
    if (streamMessageIdRef.current) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = messages[cursor];
      if (previous.sender === 'user') {
        await sendMessage(previous.content, previous.attachments || []);
        return;
      }
    }
  };

  const handleDownload = async (modelId: string) => {
    setModelState((current) => ({ ...current, [modelId]: { status: 'downloading', progress: 0 } }));
    try { await downloadModel(modelId); }
    catch (error) { setModelState((current) => ({ ...current, [modelId]: { status: 'error', progress: 0, error: error instanceof Error ? error.message : 'Download failed' } })); }
  };

  const handleLoad = async (modelId: string) => {
    const model = MODELS.find((item) => item.id === modelId);
    if (!model || modelState[modelId]?.status === 'downloading') return;
    setIsLoadingModel(true);
    setModelState((current) => ({ ...current, [modelId]: { ...(current[modelId] || { progress: 1 }), status: 'loading' } }));
    try {
      await LlamaService.getInstance().initialize(getModelPath(model.filename), {
        contextSize: settings.contextSize,
        threads: settings.threads,
        gpuLayers: settings.gpuLayers,
        mmprojPath: model.mmprojFilename ? getModelPath(model.mmprojFilename) : undefined,
        draftPath: model.mtpFilename ? getModelPath(model.mtpFilename) : undefined,
      });
      setLoadedModelId(modelId);
      setModelState((current) => ({ ...current, [modelId]: { status: 'loaded', progress: 1 } }));
      setTab('chat');
    } catch (error) {
      setModelState((current) => ({ ...current, [modelId]: { status: 'error', progress: 0, error: error instanceof Error ? error.message : 'Model load failed' } }));
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleSaveSettings = async (next: GenerationSettings, nextTavilyApiKey: string) => {
    setSettings(next);
    setTavilyApiKey(nextTavilyApiKey.trim());
    await saveGenerationSettings(next);
    await saveTavilyApiKey(nextTavilyApiKey);
  };

  const startNewChat = async () => {
    if (streamMessageIdRef.current) return;
    const session: ChatSession = {
      id: uid('session'),
      title: 'New conversation',
      createdAt: Date.now(),
      webSearchEnabled: settings.webSearchEnabled,
      webSearchDepth: settings.webSearchDepth,
      showThinking: settings.showThinking,
      thinkingEnabled: false,
    };
    await createSession(session);
    await saveActiveSessionId(session.id);
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setMessages([]);
    setArtifacts([]);
    setSelectedArtifact(null);
    setTab('chat');
  };

  if (initializing) return <View style={[styles.center, { backgroundColor: theme.background }]}><ActivityIndicator color={theme.accent} /><Text style={[styles.muted, { color: theme.muted, marginTop: 12 }]}>Preparing your private workspace...</Text></View>;
  if (initializationError) return <View style={[styles.center, { backgroundColor: theme.background, padding: 24 }]}><Text style={[styles.screenTitle, { color: theme.text, textAlign: 'center' }]}>Local workspace unavailable</Text><Text style={[styles.screenCopy, { color: theme.muted, textAlign: 'center' }]}>{initializationError}</Text></View>;

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
    <StatusBar barStyle={systemScheme === 'light' ? 'dark-content' : 'light-content'} />
    <View style={styles.app}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.flex}><Text style={[styles.brand, { color: theme.text }]}>PocketMind</Text><Text style={[styles.subtitle, { color: theme.muted }]}>{streamMessageId ? 'Generating · ' + (appState === 'active' ? 'active' : 'continuing') : loadedModelId ? (MODELS.find((model) => model.id === loadedModelId)?.name || 'Model') + ' · on device' : 'Private workspace · no cloud'}</Text></View>
        <View style={styles.headerActions}><Pressable disabled={Boolean(streamMessageId)} onPress={startNewChat} style={[styles.headerControl, { backgroundColor: theme.surfaceRaised, opacity: streamMessageId ? 0.5 : 1 }]}><Text style={[styles.headerControlText, { color: theme.text }]}>New chat</Text></Pressable><Pressable onPress={() => setTab('settings')} style={[styles.headerControl, { backgroundColor: theme.accentSoft }]}><Text style={[styles.headerControlText, { color: theme.accent }]}>Controls</Text></Pressable><View style={[styles.statusDot, { backgroundColor: loadedModelId ? theme.accent : theme.muted }]} /></View>
      </View>
      <View style={styles.content}>
        {tab === 'chat' && <ChatScreen messages={messages} theme={theme} session={chatSession} busy={Boolean(streamMessageId)} responseMode={settings.responseMode} attachments={pendingAttachments} onSetAttachments={setPendingAttachments} onToggleCanvas={async () => { const responseMode: GenerationSettings['responseMode'] = settings.responseMode === 'canvas' ? 'auto' : 'canvas'; const next = { ...settings, responseMode }; setSettings(next); await saveGenerationSettings(next); }} onUpdateSession={updateChatSession} onSend={sendMessage} onStop={stopGeneration} onRetry={retryMessage} onOpenModels={() => setTab('models')} onOpenArtifact={(artifact) => { setSelectedArtifact(artifact); setTab('artifacts'); }} artifacts={artifacts} />}
        {tab === 'artifacts' && <ArtifactsScreen artifacts={artifacts} selected={selectedArtifact} theme={theme} onSelect={setSelectedArtifact} />}
        {tab === 'models' && <ModelsScreen theme={theme} states={modelState} loadedModelId={loadedModelId} loading={isLoadingModel} onDownload={handleDownload} onLoad={handleLoad} />}
        {tab === 'settings' && <SettingsScreen theme={theme} settings={settings} tavilyApiKey={tavilyApiKey} onSave={handleSaveSettings} />}
      </View>
      <View style={[styles.nav, { backgroundColor: theme.surface, borderTopColor: theme.border }]}><NavItem icon="⌂" label="Chat" active={tab === 'chat'} theme={theme} onPress={() => setTab('chat')} /><NavItem icon="▣" label="Artifacts" active={tab === 'artifacts'} theme={theme} onPress={() => setTab('artifacts')} /><NavItem icon="◈" label="Models" active={tab === 'models'} theme={theme} onPress={() => setTab('models')} /><NavItem icon="⚙" label="Controls" active={tab === 'settings'} theme={theme} onPress={() => setTab('settings')} /></View>
    </View>
  </SafeAreaView>;
}

function ChatScreen({ messages, theme, session, busy, responseMode, attachments, onSetAttachments, onToggleCanvas, onUpdateSession, onSend, onStop, onRetry, onOpenModels, onOpenArtifact, artifacts }: { messages: Message[]; theme: AppTheme; session: ChatSession; busy: boolean; responseMode: GenerationSettings['responseMode']; attachments: MediaAttachment[]; onSetAttachments: React.Dispatch<React.SetStateAction<MediaAttachment[]>>; onToggleCanvas: () => Promise<void>; onUpdateSession: (patch: Partial<ChatSession>) => Promise<void>; onSend: (text: string, media: MediaAttachment[]) => Promise<void>; onStop: () => Promise<void>; onRetry: (messageId: string) => Promise<void>; onOpenModels: () => void; onOpenArtifact: (artifact: Artifact) => void; artifacts: Artifact[] }) {
  const [input, setInput] = useState('');
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !busy;
  const [picking, setPicking] = useState(false);

  const pickImages = async () => {
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsMultipleSelection: true, quality: 0.85 });
      if (!result.canceled) {
        const next: MediaAttachment[] = [];
        for (const asset of result.assets) next.push(await persistPickedMedia(asset.uri, 'image', (asset as any).mimeType || 'image/jpeg', asset.fileName || 'image.jpg', asset.fileSize));
        onSetAttachments((current) => [...current, ...next].slice(0, 4));
      }
    } catch (error) { Alert.alert('Could not attach image', error instanceof Error ? error.message : 'Image selection failed.'); }
    finally { setPicking(false); }
  };

  const pickAudio = async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['audio/wav', 'audio/mpeg'], copyToCacheDirectory: true });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const next = await persistPickedMedia(asset.uri, 'audio', asset.mimeType || 'audio/wav', asset.name, asset.size);
        onSetAttachments((current) => [...current, next].slice(0, 4));
      }
    } catch (error) { Alert.alert('Could not attach audio', error instanceof Error ? error.message : 'Audio selection failed.'); }
    finally { setPicking(false); }
  };

  const submit = async () => { const value = input; setInput(''); const media = attachments; onSetAttachments([]); await onSend(value, media); };
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {messages.length === 0 ? <ScrollView contentContainerStyle={styles.welcome} keyboardShouldPersistTaps="handled"><View style={[styles.welcomeMark, { backgroundColor: theme.accentSoft }]}><Text style={{ fontSize: 28 }}>✦</Text></View><Text style={[styles.welcomeTitle, { color: theme.text }]}>What would you like to make?</Text><Text style={[styles.welcomeCopy, { color: theme.muted }]}>Private chat with text, images and audio. Create useful tools, playful games, and local workspaces through conversation.</Text><View style={styles.suggestionWrap}>{['Track my expenses this month', 'Build a 5/3/1 workout tracker', 'Create a simple game for my girls'].map((suggestion) => <Pressable key={suggestion} onPress={() => setInput(suggestion)} style={[styles.suggestion, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.suggestionText, { color: theme.text }]}>{suggestion}</Text><Text style={{ color: theme.accent }}>→</Text></Pressable>)}</View><Pressable onPress={onOpenModels} style={[styles.outlineButton, { borderColor: theme.accent }]}><Text style={[styles.outlineButtonText, { color: theme.accent }]}>Set up a local model</Text></Pressable></ScrollView> : <FlatList data={messages} keyExtractor={(item) => item.id} contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled" renderItem={({ item }) => <MessageBubble message={item} theme={theme} artifacts={artifacts} onOpenArtifact={onOpenArtifact} onRetry={onRetry} />} />}
    <View style={[styles.composerArea, { backgroundColor: theme.background }]}>
      <View style={styles.chatControlRow}><ToggleChip label="Web" value={session.webSearchEnabled} theme={theme} onPress={() => void onUpdateSession({ webSearchEnabled: !session.webSearchEnabled })} /><ToggleChip label="Think" value={session.thinkingEnabled} theme={theme} onPress={() => void onUpdateSession({ thinkingEnabled: !session.thinkingEnabled })} disabled={false} /><ToggleChip label="Show" value={session.showThinking} theme={theme} onPress={() => void onUpdateSession({ showThinking: !session.showThinking })} /><Pressable onPress={() => void onToggleCanvas()} style={[styles.modeChip, { borderColor: responseMode === 'canvas' ? theme.accent : theme.border, backgroundColor: responseMode === 'canvas' ? theme.accentSoft : theme.surface }]}><Text style={{ color: responseMode === 'canvas' ? theme.accent : theme.muted, fontSize: 11, fontWeight: '800' }}>{responseMode === 'canvas' ? 'Canvas on' : responseMode === 'auto' ? 'Canvas auto' : 'Canvas off'}</Text></Pressable></View>
      {!!attachments.length && <View style={styles.attachmentRow}>{attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} theme={theme} onRemove={() => onSetAttachments((current) => current.filter((item) => item.id !== attachment.id))} />)}</View>}
      <View style={styles.composerToolbar}><Pressable disabled={picking || busy} onPress={pickImages} style={[styles.attachButton, { borderColor: theme.border, backgroundColor: theme.surface }]}><Text style={{ color: theme.text }}>＋ Image</Text></Pressable><Pressable disabled={picking || busy} onPress={pickAudio} style={[styles.attachButton, { borderColor: theme.border, backgroundColor: theme.surface }]}><Text style={{ color: theme.text }}>＋ Audio</Text></Pressable><Text style={[styles.composerHint, { color: theme.muted }]}>{busy ? 'Generating locally…' : 'Gemma supports JPEG/PNG/GIF and WAV/MP3'}</Text></View>
      <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}><TextInput value={input} onChangeText={setInput} placeholder="Ask or describe what to build…" placeholderTextColor={theme.muted} multiline maxLength={6000} style={[styles.input, { color: theme.text }]} /><Pressable accessibilityLabel={busy ? 'Stop generation' : 'Send'} disabled={busy ? false : !canSend} onPress={() => busy ? void onStop() : void submit()} style={[styles.sendButton, { backgroundColor: busy ? theme.danger : canSend ? theme.accent : theme.surfaceRaised }]}><Text style={{ color: busy || canSend ? '#101114' : theme.muted, fontSize: busy ? 14 : 20 }}>{busy ? 'Stop' : '↑'}</Text></Pressable></View>
    </View>
  </KeyboardAvoidingView>;
}

function ToggleChip({ label, value, theme, onPress, disabled }: { label: string; value: boolean; theme: AppTheme; onPress: () => void; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.modeChip, { borderColor: value ? theme.accent : theme.border, backgroundColor: value ? theme.accentSoft : theme.surface, opacity: disabled ? 0.45 : 1 }]}><Text style={{ color: value ? theme.accent : theme.muted, fontSize: 11, fontWeight: '800' }}>{label + (value ? ' on' : '')}</Text></Pressable>;
}

function AttachmentPreview({ attachment, theme, onRemove }: { attachment: MediaAttachment; theme: AppTheme; onRemove: () => void }) {
  return <View style={[styles.attachment, { backgroundColor: theme.surface, borderColor: theme.border }]}>{attachment.kind === 'image' ? <Image source={{ uri: attachment.uri }} style={styles.thumbnail} /> : <View style={[styles.audioIcon, { backgroundColor: theme.accentSoft }]}><Text style={{ color: theme.accent }}>♪</Text></View>}<Text numberOfLines={1} style={[styles.attachmentName, { color: theme.text }]}>{attachment.kind === 'image' ? 'Image' : attachment.name}</Text><Pressable onPress={onRemove}><Text style={{ color: theme.muted }}>×</Text></Pressable></View>;
}

function MessageBubble({ message, theme, artifacts, onOpenArtifact, onRetry }: { message: Message; theme: AppTheme; artifacts: Artifact[]; onOpenArtifact: (artifact: Artifact) => void; onRetry: (messageId: string) => Promise<void> }) {
  const isUser = message.sender === 'user';
  const artifact = !isUser ? artifacts.find((item) => item.sourceMessageId === message.id) : undefined;
  const readable = isUser ? message.content : stripArtifactProtocol(message.content).trim();
  return <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}><View style={[styles.bubble, { backgroundColor: isUser ? theme.userBubble : theme.assistantBubble, borderColor: theme.border }]}>{!!message.attachments?.length && <View style={styles.messageAttachments}>{message.attachments.map((attachment) => attachment.kind === 'image' ? <Image key={attachment.id} source={{ uri: attachment.uri }} style={styles.messageImage} /> : <Text key={attachment.id} style={[styles.audioLabel, { color: theme.accent }]}>♪ {attachment.name}</Text>)}</View>}{!!readable && <Text style={[styles.messageText, { color: theme.text }]}>{readable}</Text>}{artifact && <Pressable onPress={() => onOpenArtifact(artifact)} style={[styles.artifactChip, { backgroundColor: theme.accentSoft }]}><Text style={{ color: theme.accent, fontWeight: '700' }}>Open {artifact.title}</Text><Text style={{ color: theme.accent }}>↗</Text></Pressable>}{!isUser && !!message.content && <Pressable onPress={() => void onRetry(message.id)} style={styles.retryButton}><Text style={{ color: theme.accent, fontWeight: '700' }}>Retry</Text></Pressable>}{!message.content && <ActivityIndicator size="small" color={theme.accent} />}</View></View>;
}

function ArtifactsScreen({ artifacts, selected, theme, onSelect }: { artifacts: Artifact[]; selected: Artifact | null; theme: AppTheme; onSelect: (artifact: Artifact | null) => void }) {
  if (selected) return <View style={styles.flex}><View style={styles.subHeader}><Pressable onPress={() => onSelect(null)}><Text style={[styles.back, { color: theme.accent }]}>‹ Artifacts</Text></Pressable><Text numberOfLines={1} style={[styles.subHeaderTitle, { color: theme.text }]}>{selected.title}</Text><View style={{ width: 60 }} /></View><ArtifactRenderer htmlContent={selected.html} theme={theme} /></View>;
  return <ScrollView contentContainerStyle={styles.screenPadding}><Text style={[styles.screenTitle, { color: theme.text }]}>Artifacts</Text><Text style={[styles.screenCopy, { color: theme.muted }]}>Your local interactive workspaces live here.</Text>{artifacts.length === 0 ? <EmptyState theme={theme} icon="▣" title="No artifacts yet" copy="Ask the local model to create an expense sheet, workout tracker, dashboard, or game." /> : artifacts.map((artifact) => <Pressable key={artifact.id} onPress={() => onSelect(artifact)} style={[styles.artifactCard, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={[styles.artifactIcon, { backgroundColor: theme.accentSoft }]}><Text style={{ color: theme.accent }}>▦</Text></View><View style={styles.flex}><Text style={[styles.cardTitle, { color: theme.text }]}>{artifact.title}</Text><Text style={[styles.cardMeta, { color: theme.muted }]}>{new Date(artifact.createdAt).toLocaleDateString()}</Text></View><Text style={{ color: theme.muted, fontSize: 24 }}>›</Text></Pressable>)}</ScrollView>;
}

function ModelsScreen({ theme, states, loadedModelId, loading, onDownload, onLoad }: { theme: AppTheme; states: ModelState; loadedModelId: string | null; loading: boolean; onDownload: (id: string) => void; onLoad: (id: string) => void }) {
  return <ScrollView contentContainerStyle={styles.screenPadding}><Text style={[styles.screenTitle, { color: theme.text }]}>Local models</Text><Text style={[styles.screenCopy, { color: theme.muted }]}>The model bundle downloads in the background while you move between screens or turn off the display. Gemma bundles include the projector for image/audio input and the MTP drafter for faster text generation.</Text>{MODELS.map((model) => { const state = states[model.id]; const isLoaded = loadedModelId === model.id; const isBusy = state?.status === 'downloading' || state?.status === 'loading' || loading; return <View key={model.id} style={[styles.modelCard, { backgroundColor: theme.surface, borderColor: isLoaded ? theme.accent : theme.border }]}><View style={styles.modelTop}><View style={styles.flex}><View style={styles.row}><Text style={[styles.cardTitle, { color: theme.text }]}>{model.name}</Text>{model.recommended && <Text style={[styles.recommended, { color: theme.accent, backgroundColor: theme.accentSoft }]}>Recommended</Text>}</View><Text style={[styles.cardMeta, { color: theme.muted }]}>{model.sizeLabel} + {model.mmprojSizeLabel || 'text only'}{model.mtpSizeLabel ? ' + ' + model.mtpSizeLabel : ''}</Text></View>{isLoaded && <Text style={{ color: theme.accent, fontSize: 22 }}>✓</Text>}</View><Text style={[styles.modelDescription, { color: theme.muted }]}>{model.description}</Text>{state?.status === 'downloading' && <View style={[styles.progressTrack, { backgroundColor: theme.surfaceRaised }]}><View style={[styles.progressFill, { width: Math.max(2, state.progress * 100) + '%', backgroundColor: theme.accent }]} /></View>}{state?.error && <Text style={[styles.errorText, { color: theme.danger }]}>{state.error}</Text>}<View style={styles.modelActions}>{state?.status !== 'ready' && state?.status !== 'loaded' && state?.status !== 'loading' && <Pressable disabled={isBusy} onPress={() => onDownload(model.id)} style={[styles.smallButton, { borderColor: theme.border }]}><Text style={{ color: theme.text }}>{state?.status === 'error' ? 'Retry download' : 'Download bundle'}</Text></Pressable>}{(state?.status === 'ready' || isLoaded) && <Pressable disabled={isBusy && !isLoaded} onPress={() => onLoad(model.id)} style={[styles.smallButton, { backgroundColor: isLoaded ? theme.accentSoft : theme.accent, borderColor: theme.accent }]}>{state?.status === 'loading' ? <ActivityIndicator size="small" color="#101114" /> : <Text style={{ color: isLoaded ? theme.accent : '#101114', fontWeight: '700' }}>{isLoaded ? 'Reload model' : 'Load model'}</Text>}</Pressable>}</View></View>; })}</ScrollView>;
}

function SettingsScreen({ theme, settings, tavilyApiKey, onSave }: { theme: AppTheme; settings: GenerationSettings; tavilyApiKey: string; onSave: (settings: GenerationSettings, tavilyApiKey: string) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [apiKeyDraft, setApiKeyDraft] = useState(tavilyApiKey);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => setApiKeyDraft(tavilyApiKey), [tavilyApiKey]);
  const updateNumber = (key: keyof GenerationSettings, delta: number, min: number, max: number) => {
    const value = Number(draft[key]) as number;
    setDraft((current) => ({ ...current, [key]: Math.min(max, Math.max(min, Number((value + delta).toFixed(2)))) }));
    setSaved(false);
  };
  const save = async () => { await onSave(draft, apiKeyDraft); setSaved(true); };
  return <ScrollView contentContainerStyle={styles.screenPadding} keyboardShouldPersistTaps="handled"><Text style={[styles.screenTitle, { color: theme.text }]}>Controls</Text><Text style={[styles.screenCopy, { color: theme.muted }]}>Generation defaults and Tavily are global. Web search, thinking, visible reasoning, and Canvas are also available per chat in the composer.</Text><Text style={[styles.settingsSection, { color: theme.text }]}>System prompt</Text><TextInput value={draft.systemPrompt} onChangeText={(systemPrompt) => { setDraft((current) => ({ ...current, systemPrompt })); setSaved(false); }} placeholder="Leave empty for the built-in PocketMind prompt" placeholderTextColor={theme.muted} multiline textAlignVertical="top" style={[styles.settingsInput, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]} /><Text style={[styles.settingsSection, { color: theme.text }]}>Response mode</Text><View style={[styles.modeSelector, { backgroundColor: theme.surface, borderColor: theme.border }]}>{(['chat', 'auto', 'canvas'] as const).map((mode) => <Pressable key={mode} onPress={() => { setDraft((current) => ({ ...current, responseMode: mode })); setSaved(false); }} style={[styles.modeOption, { backgroundColor: draft.responseMode === mode ? theme.accent : 'transparent' }]}><Text style={{ color: draft.responseMode === mode ? '#101114' : theme.muted, fontWeight: '800', fontSize: 12 }}>{mode === 'chat' ? 'Chat' : mode === 'canvas' ? 'Canvas' : 'Auto'}</Text></Pressable>)}</View><SettingStepper theme={theme} title="Temperature" description="Lower is more predictable." value={draft.temperature} step={0.1} decimals={1} onChange={(delta) => updateNumber('temperature', delta, 0, 1.5)} /><SettingStepper theme={theme} title="Top P" description="Probability range for next-token selection." value={draft.topP} step={0.05} decimals={2} onChange={(delta) => updateNumber('topP', delta, 0.1, 1)} /><SettingStepper theme={theme} title="Max output tokens" description="Longer outputs help with artifacts." value={draft.maxTokens} step={128} decimals={0} onChange={(delta) => updateNumber('maxTokens', delta, 256, 2048)} /><Text style={[styles.settingsSection, { color: theme.text }]}>Web search default for new chats</Text><ToggleChip label="Web search" value={draft.webSearchEnabled} theme={theme} onPress={() => { setDraft((current) => ({ ...current, webSearchEnabled: !current.webSearchEnabled })); setSaved(false); }} /><TextInput value={apiKeyDraft} onChangeText={(value) => { setApiKeyDraft(value); setSaved(false); }} placeholder="Tavily API key" placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={[styles.settingsInput, { minHeight: 50, color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, marginTop: 10 }]} /><Text style={[styles.cardMeta, { color: theme.muted }]}>Stored in Android encrypted storage. Images/audio stay on the phone and are passed directly to the local model.</Text><SettingStepper theme={theme} title="Context size" description="Reload the model after changing this." value={draft.contextSize} step={512} decimals={0} onChange={(delta) => updateNumber('contextSize', delta, 1024, 4096)} /><SettingStepper theme={theme} title="CPU threads" description="More threads can improve speed but use more battery." value={draft.threads} step={1} decimals={0} onChange={(delta) => updateNumber('threads', delta, 1, 6)} /><SettingStepper theme={theme} title="GPU layers" description="Keep 0 on Pixel 10a/Mali unless verified." value={draft.gpuLayers} step={1} decimals={0} onChange={(delta) => updateNumber('gpuLayers', delta, 0, 99)} /><Pressable onPress={save} style={[styles.saveButton, { backgroundColor: theme.accent }]}><Text style={styles.saveText}>{saved ? 'Saved' : 'Save settings'}</Text></Pressable></ScrollView>;
}

function SettingStepper({ theme, title, description, value, step, decimals, onChange }: { theme: AppTheme; title: string; description: string; value: number; step: number; decimals: number; onChange: (delta: number) => void }) {
  return <View style={[styles.stepper, { borderBottomColor: theme.border }]}><View style={styles.flex}><Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text><Text style={[styles.cardMeta, { color: theme.muted }]}>{description}</Text></View><View style={styles.stepperControls}><Pressable onPress={() => onChange(-step)} style={[styles.stepperButton, { backgroundColor: theme.surfaceRaised }]}><Text style={{ color: theme.text, fontSize: 20 }}>−</Text></Pressable><Text style={[styles.stepperValue, { color: theme.text }]}>{value.toFixed(decimals)}</Text><Pressable onPress={() => onChange(step)} style={[styles.stepperButton, { backgroundColor: theme.surfaceRaised }]}><Text style={{ color: theme.text, fontSize: 20 }}>+</Text></Pressable></View></View>;
}

function EmptyState({ theme, icon, title, copy }: { theme: AppTheme; icon: string; title: string; copy: string }) {
  return <View style={styles.empty}><Text style={[styles.emptyIcon, { color: theme.accent }]}>{icon}</Text><Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text><Text style={[styles.screenCopy, { color: theme.muted, textAlign: 'center' }]}>{copy}</Text></View>;
}

function NavItem({ icon, label, active, theme, onPress }: { icon: string; label: string; active: boolean; theme: AppTheme; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.navItem}><Text style={{ color: active ? theme.accent : theme.muted, fontSize: 22 }}>{icon}</Text><Text style={[styles.navLabel, { color: active ? theme.accent : theme.muted }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, app: { flex: 1 }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { minHeight: 66, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 }, headerControl: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 }, headerControlText: { fontSize: 12, fontWeight: '800' }, brand: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }, subtitle: { fontSize: 12, marginTop: 2 }, statusDot: { width: 9, height: 9, borderRadius: 5 }, content: { flex: 1 }, nav: { height: 70, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8 }, navItem: { alignItems: 'center', minWidth: 70 }, navLabel: { fontSize: 11, marginTop: 2 },
  welcome: { padding: 24, alignItems: 'center', justifyContent: 'center', flexGrow: 1 }, welcomeMark: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, welcomeTitle: { fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: -0.7 }, welcomeCopy: { fontSize: 15, lineHeight: 22, maxWidth: 360, textAlign: 'center', marginTop: 10 }, suggestionWrap: { alignSelf: 'stretch', marginTop: 26, gap: 10 }, suggestion: { borderWidth: 1, borderRadius: 15, padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, suggestionText: { fontSize: 14, flex: 1 }, outlineButton: { marginTop: 20, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 }, outlineButtonText: { fontWeight: '700' },
  messageList: { padding: 16, paddingBottom: 24 }, messageRow: { marginVertical: 5, flexDirection: 'row' }, userRow: { justifyContent: 'flex-end' }, assistantRow: { justifyContent: 'flex-start' }, bubble: { maxWidth: '90%', padding: 14, borderRadius: 18, borderWidth: 1 }, messageText: { fontSize: 16, lineHeight: 23 }, artifactChip: { marginTop: 12, borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, retryButton: { marginTop: 10, alignSelf: 'flex-start' }, messageAttachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }, messageImage: { width: 110, height: 90, borderRadius: 10 }, audioLabel: { padding: 9, borderRadius: 10, backgroundColor: '#23372b', overflow: 'hidden' }, composerArea: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 7 }, chatControlRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 5 }, composerToolbar: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6 }, modeChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 }, attachButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 }, attachmentRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 }, attachment: { maxWidth: 170, flexDirection: 'row', alignItems: 'center', gap: 5, padding: 5, borderWidth: 1, borderRadius: 10 }, thumbnail: { width: 30, height: 30, borderRadius: 6 }, audioIcon: { width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, attachmentName: { maxWidth: 105, fontSize: 11 }, composerHint: { flex: 1, textAlign: 'right', fontSize: 9 }, composer: { minHeight: 54, maxHeight: 150, borderWidth: 1, borderRadius: 20, padding: 6, flexDirection: 'row', alignItems: 'flex-end' }, input: { flex: 1, fontSize: 16, maxHeight: 130, paddingHorizontal: 10, paddingVertical: 8 }, sendButton: { minWidth: 44, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, screenPadding: { padding: 18, paddingBottom: 30 }, screenTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.7 }, screenCopy: { fontSize: 14, lineHeight: 20, marginTop: 6 }, artifactCard: { marginTop: 12, padding: 14, borderWidth: 1, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 12 }, artifactIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, cardTitle: { fontSize: 15, fontWeight: '700' }, cardMeta: { fontSize: 12, marginTop: 4 }, subHeader: { height: 54, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { fontSize: 15, fontWeight: '700', width: 70 },
  modelCard: { marginTop: 14, padding: 16, borderWidth: 1, borderRadius: 18 }, modelTop: { flexDirection: 'row', alignItems: 'flex-start' }, row: { flexDirection: 'row', alignItems: 'center', gap: 7 }, recommended: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 }, modelDescription: { fontSize: 13, lineHeight: 19, marginTop: 9 }, progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 14 }, progressFill: { height: 6, borderRadius: 3 }, modelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 }, smallButton: { minWidth: 100, minHeight: 40, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, errorText: { fontSize: 11, marginTop: 10 },
  settingRow: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth }, settingsSection: { fontSize: 17, fontWeight: '800', marginTop: 24, marginBottom: 10 }, settingsInput: { minHeight: 130, borderWidth: 1, borderRadius: 14, padding: 12, fontSize: 14, lineHeight: 20 }, modeSelector: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 4, gap: 4 }, modeOption: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, stepper: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 }, stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 7 }, stepperButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, stepperValue: { minWidth: 48, textAlign: 'center', fontSize: 14, fontWeight: '700' }, toggleTrack: { width: 50, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' }, toggleThumb: { width: 24, height: 24, borderRadius: 12 }, saveButton: { minHeight: 48, marginTop: 24, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#101114', fontSize: 15, fontWeight: '800' }, empty: { alignItems: 'center', paddingHorizontal: 20, marginTop: 90 }, emptyIcon: { fontSize: 42, marginBottom: 14 }, muted: { fontSize: 14 },
});
