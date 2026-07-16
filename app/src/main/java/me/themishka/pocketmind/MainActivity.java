package me.themishka.pocketmind;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
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
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int PICK_GGUF = 1401;
    private SharedPreferences prefs;
    private LinearLayout conversation;
    private ScrollView scroll;
    private EditText input;
    private TextView modelTitle;
    private TextView modelMeta;
    private Button loadButton;
    private Uri selectedModel;
    private boolean modelLoaded;

    private int bg, surface, surfaceAlt, text, muted, accent, userBubble;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("pocketmind", MODE_PRIVATE);
        applyPalette();
        configureSystemBars();
        restoreModelUri();
        buildUi();
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
        if (Color.luminance(bg) > .5) w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);
        root.setPadding(dp(16), dp(12), dp(16), dp(10));

        LinearLayout top = row();
        TextView title = text("PocketMind", 22, text, true);
        top.addView(title, new LinearLayout.LayoutParams(0, dp(52), 1));
        Button newChat = iconButton("New");
        newChat.setOnClickListener(v -> resetChat());
        top.addView(newChat);
        Button settings = iconButton("Cloud");
        settings.setOnClickListener(v -> showCloudSettings());
        top.addView(settings);
        root.addView(top);

        LinearLayout modelCard = new LinearLayout(this);
        modelCard.setOrientation(LinearLayout.VERTICAL);
        modelCard.setPadding(dp(16), dp(14), dp(16), dp(14));
        modelCard.setBackground(round(surface, 22));

        LinearLayout modelHeader = row();
        LinearLayout modelTexts = new LinearLayout(this);
        modelTexts.setOrientation(LinearLayout.VERTICAL);
        modelTitle = text(selectedModel == null ? "Choose a local GGUF model" : getSavedName(), 17, text, true);
        modelMeta = text(selectedModel == null ? "Runs privately on this phone" : "Inspecting model…", 13, muted, false);
        modelTexts.addView(modelTitle);
        modelTexts.addView(modelMeta);
        modelHeader.addView(modelTexts, new LinearLayout.LayoutParams(0, -2, 1));
        Button choose = iconButton(selectedModel == null ? "Choose" : "Change");
        choose.setOnClickListener(v -> chooseModel());
        modelHeader.addView(choose);
        modelCard.addView(modelHeader);

        loadButton = new Button(this);
        loadButton.setAllCaps(false);
        loadButton.setText(selectedModel == null ? "Select model" : "Load model");
        loadButton.setTextColor(Color.WHITE);
        loadButton.setTextSize(15);
        loadButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        loadButton.setBackground(round(accent, 18));
        loadButton.setOnClickListener(v -> {
            if (selectedModel == null) chooseModel(); else toggleModel();
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(48));
        lp.topMargin = dp(12);
        modelCard.addView(loadButton, lp);
        root.addView(modelCard);

        scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        conversation = new LinearLayout(this);
        conversation.setOrientation(LinearLayout.VERTICAL);
        conversation.setPadding(0, dp(16), 0, dp(14));
        scroll.addView(conversation);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        addWelcome();

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
        Button send = iconButton("Send");
        send.setOnClickListener(v -> send());
        composer.addView(send, new LinearLayout.LayoutParams(dp(72), dp(48)));
        root.addView(composer);

        setContentView(root);
        if (selectedModel != null) inspectModel(selectedModel);
    }

    private void addWelcome() {
        addAssistant("Local first. Choose Ternary-Bonsai-8B-Q2_0_g64.gguf above. Your prompts stay on this device when the local runtime is active.");
    }

    private void chooseModel() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/octet-stream");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream", "application/x-gguf", "*/*"});
        startActivityForResult(i, PICK_GGUF);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_GGUF || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(uri,
                    data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        } catch (Exception ignored) { }
        selectedModel = uri;
        String name = queryName(uri);
        prefs.edit().putString("modelUri", uri.toString()).putString("modelName", name).apply();
        modelTitle.setText(name);
        loadButton.setText("Load model");
        modelLoaded = false;
        inspectModel(uri);
    }

    private void restoreModelUri() {
        String value = prefs.getString("modelUri", "");
        if (!value.isEmpty()) selectedModel = Uri.parse(value);
    }

    private String getSavedName() { return prefs.getString("modelName", "Selected GGUF model"); }

    private void inspectModel(Uri uri) {
        String name = queryName(uri);
        long size = querySize(uri);
        String details = size > 0 ? formatBytes(size) : "Size unavailable";
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            byte[] header = new byte[24];
            int read = in == null ? 0 : in.read(header);
            if (read >= 16) {
                String magic = new String(header, 0, 4, java.nio.charset.StandardCharsets.US_ASCII);
                ByteBuffer b = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
                int version = b.getInt(4);
                long tensors = b.getLong(8);
                if ("GGUF".equals(magic)) details += "  •  GGUF v" + version + "  •  " + tensors + " tensors";
                else details += "  •  Not recognized as GGUF";
            }
        } catch (Exception e) { details += "  •  File access error"; }
        modelTitle.setText(name);
        modelMeta.setText(details);
    }

    private void toggleModel() {
        if (modelLoaded) {
            modelLoaded = false;
            loadButton.setText("Load model");
            modelMeta.setText(modelMeta.getText() + "  •  Unloaded");
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Native runtime not connected yet")
                .setMessage("The GGUF selection and metadata layer is working. The next commit connects the PrismML llama.cpp Android runtime required for this g64 ternary model. This build will not pretend that inference is available before that native library is present.")
                .setPositiveButton("OK", null)
                .show();
    }

    private void send() {
        String value = input.getText().toString().trim();
        if (value.isEmpty()) return;
        addUser(value);
        input.setText("");
        if (!modelLoaded) addAssistant("Load a compatible local model before generating. Model selection is ready; native inference is the remaining blocker.");
    }

    private void addUser(String value) { addBubble(value, true); }
    private void addAssistant(String value) {
        addBubble(value, false);
        addArtifacts(value);
    }

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
        for (String raw : source.split("\\n")) {
            String line = raw.trim();
            if (line.startsWith("### ")) line = line.substring(4);
            else if (line.startsWith("## ")) line = line.substring(3);
            else if (line.startsWith("# ")) line = line.substring(2);
            if (line.startsWith("- ") || line.startsWith("* ")) line = "• " + line.substring(2);
            int start = out.length();
            out.append(line.replace("```", "")).append('\n');
            if (raw.startsWith("#")) out.setSpan(new StyleSpan(Typeface.BOLD), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return out;
    }

    private void addArtifacts(String value) {
        int start = value.indexOf("```");
        if (start < 0) return;
        int bodyStart = value.indexOf('\n', start);
        int end = value.indexOf("```", bodyStart + 1);
        if (bodyStart < 0 || end < 0) return;
        String type = value.substring(start + 3, bodyStart).trim().toLowerCase(Locale.ROOT);
        String body = value.substring(bodyStart + 1, end);
        Button artifact = iconButton("Open " + (type.isEmpty() ? "artifact" : type));
        artifact.setOnClickListener(v -> showArtifact(type, body));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(50));
        p.setMargins(0, dp(6), 0, dp(10));
        conversation.addView(artifact, p);
    }

    private void showArtifact(String type, String body) {
        if (type.equals("html") || type.equals("svg")) {
            WebView web = new WebView(this);
            web.getSettings().setJavaScriptEnabled(false);
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

    private void resetChat() { conversation.removeAllViews(); addWelcome(); }

    private void showCloudSettings() {
        new AlertDialog.Builder(this)
                .setTitle("Optional cloud providers")
                .setMessage("Cloud configuration remains secondary. The primary workflow is on-device GGUF inference.")
                .setPositiveButton("OK", null).show();
    }

    private String queryName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) return c.getString(i);
            }
        } catch (Exception ignored) { }
        return uri.getLastPathSegment() == null ? "Selected GGUF model" : uri.getLastPathSegment();
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
        double gib = bytes / 1073741824.0;
        return gib >= 1 ? String.format(Locale.US, "%.2f GiB", gib) : String.format(Locale.US, "%.1f MiB", bytes / 1048576.0);
    }

    private LinearLayout row() { LinearLayout l = new LinearLayout(this); l.setGravity(Gravity.CENTER_VERTICAL); return l; }
    private TextView text(String value, float size, int color, boolean bold) {
        TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD); return v;
    }
    private Button iconButton(String value) {
        Button b = new Button(this); b.setText(value); b.setAllCaps(false); b.setTextColor(text); b.setTextSize(13);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(12), 0, dp(12), 0); b.setBackground(round(surfaceAlt, 18));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, dp(42)); p.setMargins(dp(7), 0, 0, 0); b.setLayoutParams(p); return b;
    }
    private GradientDrawable round(int color, int radius) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius)); return d; }
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}