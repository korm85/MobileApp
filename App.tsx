import React, {useMemo, useRef, useState} from 'react';
import {Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, View} from 'react-native';
import {pick} from '@react-native-documents/picker';
import {askLocalModel, loadLocalModel, stopLocalModel} from './src/services/llama';

type Message = {id: string; role: 'user' | 'assistant'; text: string};
const initial: Message[] = [{id: 'welcome', role: 'assistant', text: 'Welcome to PocketMind. Choose your local GGUF model, then ask me to think, code, or create something.'}];
const systemPrompt = 'You are PocketMind, a capable private local assistant. Answer naturally, with clean human-friendly formatting. When asked to create a visual artifact, return a complete HTML document inside a fenced html block.';

function extractArtifact(text: string) {
  const match = text.match(/```html\s*([\s\S]*?)```/i);
  return match?.[1];
}

export default function App() {
  const [messages, setMessages] = useState(initial);
  const [input, setInput] = useState('');
  const [modelName, setModelName] = useState('No model selected');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [artifact, setArtifact] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const list = useRef<FlatList<Message>>(null);
  const canSend = input.trim().length > 0 && !loading && progress === null;
  const displayStatus = useMemo(() => progress !== null ? `Loading model ${Math.round(progress * 100)}%` : loading ? 'Thinking locally' : modelName, [loading, modelName, progress]);

  const chooseModel = async () => {
    try {
      const [file] = await pick({allowMultiSelection: false});
      if (!file?.uri || !file.name?.toLowerCase().endsWith('.gguf')) throw new Error('Please choose a .gguf model file.');
      setProgress(0);
      await loadLocalModel(file.uri, setProgress);
      setModelName(file.name);
    } catch (error) {
      Alert.alert('Model was not loaded', error instanceof Error ? error.message : 'Please try selecting the GGUF file again.');
    } finally { setProgress(null); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !canSend) return;
    const user: Message = {id: `${Date.now()}u`, role: 'user', text};
    const assistantId = `${Date.now()}a`;
    setInput(''); setLoading(true); setMessages(current => [...current, user, {id: assistantId, role: 'assistant', text: ''}]);
    const transcript = [...messages, user].map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
    let answer = '';
    try {
      await askLocalModel(`${systemPrompt}\n\n${transcript}\nAssistant:`, token => {
        answer += token;
        setMessages(current => current.map(m => m.id === assistantId ? {...m, text: answer} : m));
        const tool = answer.match(/\{\s*"action"\s*:\s*"([^"]+)"[^}]*\}/);
        if (tool) setDebug(current => current.includes(tool[0]) ? current : [...current, `Tool request intercepted: ${tool[1]}`]);
      });
      const html = extractArtifact(answer); if (html) setArtifact(html);
    } catch (error) {
      setMessages(current => current.map(m => m.id === assistantId ? {...m, text: `I could not respond: ${error instanceof Error ? error.message : 'unknown local inference error'}`} : m));
    } finally { setLoading(false); }
  };

  return <SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content" backgroundColor="#F6F4EE" />
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <View style={styles.header}><View><Text style={styles.title}>PocketMind</Text><Text style={styles.status} numberOfLines={1}>{displayStatus}</Text></View><Pressable style={styles.modelButton} onPress={chooseModel}><Text style={styles.modelButtonText}>Model</Text></Pressable></View>
      {progress !== null && <View style={styles.progress}><View style={[styles.progressFill, {width: `${Math.round(progress * 100)}%`}]} /></View>}
      <FlatList ref={list} data={messages} keyExtractor={item => item.id} contentContainerStyle={styles.chat} onContentSizeChange={() => list.current?.scrollToEnd({animated: true})} renderItem={({item}) => <Pressable onLongPress={() => {const html = extractArtifact(item.text); if (html) setArtifact(html);}} style={[styles.bubble, item.role === 'user' ? styles.user : styles.assistant]}><Text style={[styles.message, item.role === 'user' && styles.userText]}>{item.text || '…'}</Text>{extractArtifact(item.text) && <Text style={styles.artifactHint}>Tap and hold to preview artifact</Text>}</Pressable>} />
      {debug.length > 0 && <View style={styles.debug}><Text style={styles.debugTitle}>Agent activity</Text>{debug.slice(-2).map(line => <Text key={line} style={styles.debugText}>{line}</Text>)}</View>}
      <View style={styles.composer}><TextInput value={input} onChangeText={setInput} editable={!loading && progress === null} onSubmitEditing={send} multiline placeholder="Message PocketMind" placeholderTextColor="#7C7A71" style={styles.input} /><Pressable onPress={loading ? stopLocalModel : send} style={[styles.send, !canSend && !loading && styles.disabled]}><Text style={styles.sendText}>{loading ? 'Stop' : 'Send'}</Text></Pressable></View>
    </KeyboardAvoidingView>
    <Modal visible={artifact !== null} animationType="slide" onRequestClose={() => setArtifact(null)}><SafeAreaView style={styles.preview}><View style={styles.header}><Text style={styles.title}>Artifact preview</Text><Pressable onPress={() => setArtifact(null)}><Text style={styles.close}>Close</Text></Pressable></View><Text style={styles.previewText}>{artifact ? 'Your local model created HTML. Preview is ready for the WebView-enabled artifact surface.' : ''}</Text></SafeAreaView></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({safe:{flex:1,backgroundColor:'#F6F4EE'},header:{paddingHorizontal:20,paddingVertical:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderColor:'#E4E0D7'},title:{fontSize:22,fontWeight:'800',color:'#1D281E'},status:{fontSize:12,color:'#687267',marginTop:2,maxWidth:250},modelButton:{backgroundColor:'#1D281E',paddingHorizontal:16,paddingVertical:9,borderRadius:20},modelButtonText:{color:'#fff',fontWeight:'700'},progress:{height:4,backgroundColor:'#E4E0D7'},progressFill:{height:4,backgroundColor:'#789468'},chat:{padding:16,gap:10},bubble:{maxWidth:'88%',padding:14,borderRadius:18},user:{alignSelf:'flex-end',backgroundColor:'#1D281E',borderBottomRightRadius:4},assistant:{alignSelf:'flex-start',backgroundColor:'#FFFFFF',borderBottomLeftRadius:4},message:{fontSize:16,lineHeight:23,color:'#20241E'},userText:{color:'#fff'},artifactHint:{color:'#67835C',fontSize:12,marginTop:8,fontWeight:'700'},debug:{marginHorizontal:16,marginBottom:8,padding:10,borderRadius:12,backgroundColor:'#E8EEE3'},debugTitle:{fontWeight:'800',color:'#35502E'},debugText:{fontSize:12,color:'#4B5E47'},composer:{padding:12,paddingBottom:14,flexDirection:'row',gap:10,borderTopWidth:1,borderColor:'#E4E0D7',backgroundColor:'#F6F4EE',alignItems:'flex-end'},input:{flex:1,maxHeight:120,minHeight:48,backgroundColor:'#fff',borderRadius:18,paddingHorizontal:16,paddingVertical:11,color:'#20241E',fontSize:16},send:{height:48,paddingHorizontal:16,justifyContent:'center',borderRadius:18,backgroundColor:'#789468'},disabled:{opacity:.45},sendText:{color:'#fff',fontWeight:'800'},preview:{flex:1,backgroundColor:'#F6F4EE'},close:{fontWeight:'800',color:'#547448'},previewText:{padding:20,color:'#4B5E47'}});
