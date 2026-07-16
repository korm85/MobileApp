package me.themishka.pocketmind;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int PICK_GGUF = 1401;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private SharedPreferences prefs;
    private LinearLayout conversation;
    private ScrollView scroll;
    private EditText input;
    private TextView modelTitle;
    private TextView modelMeta;
    private Button loadButton;
    private Button sendButton;
    private ProgressBar progress;
    private Uri selectedModel;
    private ParcelFileDescriptor openModelDescriptor;
    private boolean modelLoaded;
    private boolean generating;
    private int bg, surface, surfaceAlt, text, muted, accent, userBubble;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("pocketmind", MODE_PRIVATE);
        applyPalette();
        configureSystemBars();
        restoreModelUri();
        buildUi();
    }

    @Override protected void onDestroy() {
        NativeBridge.stopGeneration();
        NativeBridge.unloadModel();
        closeDescriptor();
        worker.shutdownNow();
        super.onDestroy();
    }

    private void applyPalette() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        bg = dark ? Color.rgb(18,18,20) : Color.rgb(250,249,252);
        surface = dark ? Color.rgb(31,31,35) : Color.WHITE;
        surfaceAlt = dark ? Color.rgb(42,42,47) : Color.rgb(241,239,244);
        text = dark ? Color.rgb(245,244,248) : Color.rgb(31,29,35);
        muted = dark ? Color.rgb(184,181,190) : Color.rgb(101,97,108);
        accent = dark ? Color.rgb(208,188,255) : Color.rgb(103,80,164);
        userBubble = dark ? Color.rgb(76,58,112) : Color.rgb(232,222,255);
    }

    private void configureSystemBars() {
        Window w = getWindow();
        w.setStatusBarColor(bg);
        w.setNavigationBarColor(bg);
        if (Color.luminance(bg) > .5) {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);
        root.setPadding(dp(16), dp(12), dp(16), dp(10));

        LinearLayout top = row();
        top.addView(text("PocketMind", 22, text, true), new LinearLayout.LayoutParams(0, dp(52), 1));
        Button newChat = smallButton("New");
        newChat.setOnClickListener(v -> resetChat());
        top.addView(newChat);
        Button cloud = smallButton("Cloud");
        cloud.setOnClickListener(v -> showCloudSettings());
        top.addView(cloud);
        root.addView(top);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        card.setBackground(round(surface, 22));

        LinearLayout header = row();
        LinearLayout labels = new LinearLayout(this);
        labels.setOrientation(LinearLayout.VERTICAL);
        modelTitle = text(selectedModel == null ? "Choose a local GGUF model" : getSavedName(), 17, text, true);
        modelMeta = text(selectedModel == null ? "Offline inference on this phone" : "Inspecting model…", 13, muted, false);
        labels.addView(modelTitle);
        labels.addView(modelMeta);
        header.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
        Button choose = smallButton(selectedModel == null ? "Choose" : "Change");
        choose.setOnClickListener(v -> chooseModel());
        header.addView(choose);
        card.addView(header);

        loadButton = primaryButton(selectedModel == null ? "Select model" : "Load model");
        loadButton.setOnClickListener(v -> {
            if (selectedModel == null) chooseModel(); else toggleModel();
        });
        LinearLayout.LayoutParams loadParams = new LinearLayout.LayoutParams(-1, dp(48));
        loadParams.topMargin = dp(12);
        card.addView(loadButton, loadParams);
        root.addView(card);

        scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        conversation = new LinearLayout(this);
        conversation.setOrientation(LinearLayout.VERTICAL);
        conversation.setPadding(0, dp(16), 0, dp(14));
        scroll.addView(conversation);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        addAssistant("Choose Ternary-Bonsai-8B-Q2_0_g64.gguf, load it locally, then chat with airplane mode enabled.");

        LinearLayout composer = row();
        composer.setPadding(dp(4), dp(4), dp(4), dp(4));
        composer.setBackground(round(surface, 28));
        input = new EditText(this);
        input.setHint("Message your local model");
        input.setHintTextColor(muted);
        input.setTextColor(text);
        input.setTextSize(16);
        input.setMinLines(1);
        input.setMaxLines(5);
        input.setBackgroundColor(Color.TRANSPARENT);
        input.setPadding(dp(12), dp(8), dp(12), dp(8));
        input.setImeOptions(EditorInfo.IME_ACTION_SEND);
        input.setOnEditorActionListener((v, action, e) -> {
            if (action == EditorInfo.IME_ACTION_SEND) { send(); return true; }
            return false;
        });
        composer.addView(input, new LinearLayout.LayoutParams(0, -2, 1));

        progress = new ProgressBar(this);
        progress.setVisibility(View.GONE);
        composer.addView(progress, new LinearLayout.LayoutParams(dp(42), dp(42)));

        sendButton = smallButton("Send");
        sendButton.setOnClickListener(v -> {
            if (generating) stopGeneration(); else send();
        });
        composer.addView(sendButton, new LinearLayout.LayoutParams(dp(72), dp(48)));
        root.addView(composer);

        setContentView(root);
        if (selectedModel != null) inspectModel(selectedModel);
    }

    private void chooseModel() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(i, PICK_GGUF);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_GGUF || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) { }
        if (!queryName(uri).toLowerCase(Locale.ROOT).endsWith(".gguf")) {
            Toast.makeText(this, "Choose a .gguf model file.", Toast.LENGTH_LONG).show();
            return;
        }
        if (modelLoaded) unloadModel();
        selectedModel = uri;
        prefs.edit().putString("modelUri", uri.toString()).putString("modelName", queryName(uri)).apply();
        loadButton.setText("Load model");
        inspectModel(uri);
    }

    private void restoreModelUri() {
        String value = prefs.getString("modelUri", "");
        if (!value.isEmpty()) selectedModel = Uri.parse(value);
    }

    private String getSavedName() { return prefs.getString("modelName", "Selected GGUF model"); }

    private void inspectModel(Uri uri) {
        String details = querySize(uri) > 0 ? formatBytes(querySize(uri)) : "Size unavailable";
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            byte[] header = new byte[24];
            int read = in == null ? 0 : in.read(header);
            if (read >= 16) {
                String magic = new String(header, 0, 4, java.nio.charset.StandardCharsets.US_ASCII);
                ByteBuffer b = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
                int version = b.getInt(4);
                long tensors = b.getLong(8);
                details += "GGUF".equals(magic)
                        ? "  •  GGUF v" + version + "  •  " + tensors + " tensors"
                        : "  •  Invalid GGUF header";
            }
        } catch (Exception e) { details += "  •  File access error"; }
        modelTitle.setText(queryName(uri));
        modelMeta.setText(details);
    }

    private void toggleModel() {
        if (modelLoaded) { unloadModel(); return; }
        loadButton.setEnabled(false);
        loadButton.setText("Loading model…");
        worker.execute(() -> {
            try {
                closeDescriptor();
                openModelDescriptor = getContentResolver().openFileDescriptor(selectedModel, "r");
                if (openModelDescriptor == null) throw new IllegalStateException("Android could not open the model file.");
                int threads = Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors() - 2));
                boolean loaded = NativeBridge.loadModel(openModelDescriptor.getFd(), 2048, threads);
                String error = NativeBridge.lastError();
                runOnUiThread(() -> {
                    loadButton.setEnabled(true);
                    if (loaded) {
                        modelLoaded = true;
                        loadButton.setText("Unload model");
                        modelMeta.setText("Loaded locally  •  2048 context  •  " + threads + " threads");
                        addAssistant("Model loaded. Local generation is ready.");
                    } else {
                        loadButton.setText("Load model");
                        modelMeta.setText("Load failed");
                        showError(error.isEmpty() ? "Native model load failed." : error);
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loadButton.setEnabled(true);
                    loadButton.setText("Load model");
                    showError(e.getMessage());
                });
            }
        });
    }

    private void unloadModel() {
        NativeBridge.stopGeneration();
        NativeBridge.unloadModel();
        closeDescriptor();
        modelLoaded = false;
        generating = false;
        loadButton.setText("Load model");
        inspectModel(selectedModel);
        setGenerating(false);
    }

    private void send() {
        String value = input.getText().toString().trim();
        if (value.isEmpty()) return;
        if (!modelLoaded) {
            Toast.makeText(this, "Load the local GGUF model first.", Toast.LENGTH_LONG).show();
            return;
        }
        addUser(value);
        input.setText("");
        setGenerating(true);
        String prompt = "<|im_start|>system\nYou are a direct, helpful assistant. Use clear Markdown and put complete artifacts in fenced code blocks.<|im_end|>\n"
                + "<|im_start|>user\n" + value + "<|im_end|>\n<|im_start|>assistant\n";
        worker.execute(() -> {
            String answer = NativeBridge.generate(prompt, 512);
            String error = NativeBridge.lastError();
            runOnUiThread(() -> {
                setGenerating(false);
                if (!answer.trim().isEmpty()) addAssistant(answer.trim());
                else showError(error.isEmpty() ? "The model returned no text." : error);
            });
        });
    }

    private void stopGeneration() {
        NativeBridge.stopGeneration();
        sendButton.setText("Stopping");
    }

    private void setGenerating(boolean active) {
        generating = active;
        progress.setVisibility(active ? View.VISIBLE : View.GONE);
        input.setEnabled(!active);
        sendButton.setText(active ? "Stop" : "Send");
    }

    private void addUser(String value) { addBubble(value, true); }
    private void addAssistant(String value) { addBubble(value, false); addArtifacts(value); }

    private void addBubble(String value, boolean user) {
        TextView bubble = text("", 16, text, false);
        bubble.setText(renderFriendly(value));
        bubble.setTextIsSelectable(true);
        bubble.setLineSpacing(0, 1.15f);
        bubble.setPadding(dp(15), dp(12), dp(15), dp(12));
        bubble.setBackground(round(user ? userBubble : surface, 20));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
        p.gravity = user ? Gravity.END : Gravity.START;
        p.setMargins(user ? dp(52) : 0, dp(6), user ? 0 : dp(34), dp(6));
        conversation.addView(bubble, p);
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private CharSequence renderFriendly(String source) {
        SpannableStringBuilder out = new SpannableStringBuilder();
        boolean code = false;
        for (String raw : source.split("\\n")) {
            String line = raw;
            if (line.trim().startsWith("```")) { code = !code; continue; }
            int start = out.length();
            if (!code) {
                String trimmed = line.trim();
                if (trimmed.startsWith("### ")) line = trimmed.substring(4);
                else if (trimmed.startsWith("## ")) line = trimmed.substring(3);
                else if (trimmed.startsWith("# ")) line = trimmed.substring(2);
                else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) line = "• " + trimmed.substring(2);
                line = line.replace("**", "").replace("__", "");
            }
            out.append(line).append('\n');
            if (!code && raw.trim().startsWith("#")) {
                out.setSpan(new StyleSpan(Typeface.BOLD), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
        }
        return out;
    }

    private void addArtifacts(String value) {
        int cursor = 0;
        while (true) {
            int start = value.indexOf("```", cursor);
            if (start < 0) return;
            int bodyStart = value.indexOf('\n', start);
            int end = bodyStart < 0 ? -1 : value.indexOf("```", bodyStart + 1);
            if (bodyStart < 0 || end < 0) return;
            String type = value.substring(start + 3, bodyStart).trim().toLowerCase(Locale.ROOT);
            String body = value.substring(bodyStart + 1, end);
            Button artifact = smallButton("Open " + (type.isEmpty() ? "artifact" : type));
            artifact.setOnClickListener(v -> showArtifact(type, body));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(50));
            p.setMargins(0, dp(6), 0, dp(10));
            conversation.addView(artifact, p);
            cursor = end + 3;
        }
    }

    private void showArtifact(String type, String body) {
        if (type.equals("html") || type.equals("svg")) {
            WebView web = new WebView(this);
            web.getSettings().setJavaScriptEnabled(false);
            web.getSettings().setAllowFileAccess(false);
            web.getSettings().setAllowContentAccess(false);
            String html = type.equals("svg") ? "<html><body>" + body + "</body></html>" : body;
            web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            new AlertDialog.Builder(this).setTitle("Artifact preview").setView(web).setNegativeButton("Close", null).show();
        } else {
            TextView source = text(body, 14, text, false);
            source.setTextIsSelectable(true);
            source.setPadding(dp(18), dp(14), dp(18), dp(14));
            ScrollView s = new ScrollView(this); s.addView(source);
            new AlertDialog.Builder(this).setTitle("Artifact preview").setView(s).setNegativeButton("Close", null).show();
        }
    }

    private void resetChat() { conversation.removeAllViews(); addAssistant("New local conversation."); }

    private void showCloudSettings() {
        new AlertDialog.Builder(this).setTitle("Optional cloud providers")
                .setMessage("Cloud providers remain secondary. This build prioritizes fully offline GGUF inference.")
                .setPositiveButton("OK", null).show();
    }

    private void showError(String message) {
        new AlertDialog.Builder(this).setTitle("PocketMind").setMessage(message == null ? "Unknown error" : message)
                .setPositiveButton("OK", null).show();
    }

    private void closeDescriptor() {
        try { if (openModelDescriptor != null) openModelDescriptor.close(); } catch (Exception ignored) { }
        openModelDescriptor = null;
    }

    private String queryName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) return c.getString(i);
            }
        } catch (Exception ignored) { }
        return uri.getLastPathSegment() == null ? "Selected model" : uri.getLastPathSegment();
    }

    private long querySize(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0 && !c.isNull(i)) return c.getLong(i);
            }
        } catch (Exception ignored) { }
        return -1;
    }

    private String formatBytes(long bytes) {
        double gb = bytes / 1073741824.0;
        return gb >= 1 ? String.format(Locale.US, "%.2f GiB", gb)
                : String.format(Locale.US, "%.0f MiB", bytes / 1048576.0);
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value); t.setTextSize(size); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private Button smallButton(String value) {
        Button b = new Button(this);
        b.setText(value); b.setAllCaps(false); b.setTextColor(text); b.setTextSize(13);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(12), 0, dp(12), 0);
        b.setBackground(round(surfaceAlt, 18));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, dp(42));
        p.setMargins(dp(6), 0, 0, 0); b.setLayoutParams(p);
        return b;
    }

    private Button primaryButton(String value) {
        Button b = new Button(this);
        b.setText(value); b.setAllCaps(false); b.setTextColor(Color.WHITE); b.setTextSize(15);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD); b.setBackground(round(accent, 18));
        return b;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius)); return d;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
