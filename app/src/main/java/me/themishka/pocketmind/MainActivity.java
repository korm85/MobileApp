package me.themishka.pocketmind;

import android.app.AlertDialog;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int BG = Color.rgb(17, 19, 24);
    private static final int SURFACE = Color.rgb(31, 34, 42);
    private static final int USER = Color.rgb(74, 52, 112);
    private static final int TEXT = Color.rgb(238, 240, 245);
    private static final int MUTED = Color.rgb(171, 177, 190);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<JSONObject> messages = new ArrayList<>();

    private SharedPreferences prefs;
    private LinearLayout conversation;
    private ScrollView scroll;
    private EditText input;
    private ProgressBar progress;
    private Button send;
    private String lastAssistantText = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(BG);
        window.setNavigationBarColor(BG);
        prefs = getSharedPreferences("pocketmind", Context.MODE_PRIVATE);
        buildUi();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(14), dp(10), dp(14), dp(10));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = new TextView(this);
        title.setText("PocketMind");
        title.setTextColor(TEXT);
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0, dp(52), 1));

        Button artifact = compactButton("Artifact");
        artifact.setOnClickListener(v -> showArtifact());
        header.addView(artifact);

        Button settings = compactButton("Settings");
        settings.setOnClickListener(v -> showSettings());
        header.addView(settings);
        root.addView(header);

        scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        conversation = new LinearLayout(this);
        conversation.setOrientation(LinearLayout.VERTICAL);
        conversation.setPadding(0, dp(8), 0, dp(12));
        scroll.addView(conversation);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        addIntro();

        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setGravity(Gravity.BOTTOM | Gravity.CENTER_VERTICAL);
        inputRow.setPadding(0, dp(6), 0, 0);

        input = new EditText(this);
        input.setHint("Message PocketMind");
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setTextSize(16);
        input.setMinLines(1);
        input.setMaxLines(5);
        input.setPadding(dp(14), dp(10), dp(14), dp(10));
        input.setBackground(makeBackground(SURFACE, 24));
        inputRow.addView(input, new LinearLayout.LayoutParams(0, -2, 1));

        progress = new ProgressBar(this);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(34), dp(34));
        progressParams.setMargins(dp(8), 0, dp(4), dp(4));
        inputRow.addView(progress, progressParams);

        send = compactButton("Send");
        send.setOnClickListener(v -> submit());
        LinearLayout.LayoutParams sendParams = new LinearLayout.LayoutParams(-2, dp(48));
        sendParams.setMargins(dp(8), 0, 0, 0);
        inputRow.addView(send, sendParams);
        root.addView(inputRow);

        setContentView(root);
    }

    private void addIntro() {
        TextView intro = new TextView(this);
        intro.setText("Private, configurable AI chat. Open Settings to choose your endpoint, model, system prompt, and reasoning level.");
        intro.setTextColor(MUTED);
        intro.setTextSize(15);
        intro.setPadding(dp(14), dp(14), dp(14), dp(14));
        intro.setBackground(makeBackground(SURFACE, 18));
        conversation.addView(intro, bubbleParams(false));
    }

    private void submit() {
        String text = input.getText().toString().trim();
        if (text.isEmpty()) return;

        String endpoint = prefs.getString("endpoint", "");
        String apiKey = prefs.getString("apiKey", "");
        String model = prefs.getString("model", "");
        if (endpoint.isEmpty() || model.isEmpty()) {
            Toast.makeText(this, "Configure endpoint and model in Settings.", Toast.LENGTH_LONG).show();
            showSettings();
            return;
        }

        input.setText("");
        addBubble(text, true);
        try {
            messages.add(new JSONObject().put("role", "user").put("content", text));
        } catch (Exception ignored) { }

        setBusy(true);
        executor.execute(() -> requestCompletion(endpoint, apiKey, model));
    }

    private void requestCompletion(String endpoint, String apiKey, String model) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(180000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            if (!apiKey.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + apiKey);

            JSONObject body = new JSONObject();
            body.put("model", model);
            JSONArray outgoing = new JSONArray();
            String systemPrompt = prefs.getString("systemPrompt", "You are a useful, direct assistant. Format answers naturally without visible Markdown syntax.");
            if (!systemPrompt.trim().isEmpty()) {
                outgoing.put(new JSONObject().put("role", "system").put("content", systemPrompt));
            }
            for (JSONObject message : messages) outgoing.put(message);
            body.put("messages", outgoing);
            body.put("temperature", Double.parseDouble(prefs.getString("temperature", "0.7")));
            String reasoning = prefs.getString("reasoning", "medium");
            if (!reasoning.equals("off")) body.put("reasoning_effort", reasoning);

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(payload);
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String response = readAll(stream);
            if (status < 200 || status >= 300) throw new Exception("HTTP " + status + ": " + response);

            JSONObject json = new JSONObject(response);
            String answer = json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content", "");
            if (answer.isEmpty()) throw new Exception("The model returned an empty response.");
            String clean = humanFormat(answer);
            messages.add(new JSONObject().put("role", "assistant").put("content", answer));
            lastAssistantText = clean;
            main.post(() -> {
                addBubble(clean, false);
                setBusy(false);
            });
        } catch (Exception error) {
            main.post(() -> {
                addBubble("Request failed: " + error.getMessage(), false);
                setBusy(false);
            });
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line).append('\n');
        }
        return result.toString();
    }

    private String humanFormat(String text) {
        return text
                .replaceAll("(?m)^#{1,6}\\s*", "")
                .replaceAll("\\*\\*(.*?)\\*\\*", "$1")
                .replaceAll("__(.*?)__", "$1")
                .replaceAll("(?m)^[-*]\\s+", "• ")
                .replace("```", "")
                .trim();
    }

    private void addBubble(String text, boolean isUser) {
        TextView bubble = new TextView(this);
        bubble.setText(text);
        bubble.setTextColor(TEXT);
        bubble.setTextSize(16);
        bubble.setTextIsSelectable(true);
        bubble.setLineSpacing(0, 1.12f);
        bubble.setPadding(dp(14), dp(11), dp(14), dp(11));
        bubble.setBackground(makeBackground(isUser ? USER : SURFACE, 18));
        conversation.addView(bubble, bubbleParams(isUser));
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private LinearLayout.LayoutParams bubbleParams(boolean isUser) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, -2);
        params.gravity = isUser ? Gravity.END : Gravity.START;
        params.setMargins(isUser ? dp(46) : 0, dp(6), isUser ? 0 : dp(46), dp(6));
        return params;
    }

    private void setBusy(boolean busy) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        send.setEnabled(!busy);
        input.setEnabled(!busy);
    }

    private void showArtifact() {
        if (lastAssistantText.isEmpty()) {
            Toast.makeText(this, "No assistant artifact is available yet.", Toast.LENGTH_SHORT).show();
            return;
        }
        ScrollView wrapper = new ScrollView(this);
        TextView preview = new TextView(this);
        preview.setText(lastAssistantText);
        preview.setTextColor(Color.DKGRAY);
        preview.setTextSize(16);
        preview.setTextIsSelectable(true);
        preview.setPadding(dp(20), dp(16), dp(20), dp(16));
        wrapper.addView(preview);
        new AlertDialog.Builder(this)
                .setTitle("Artifact preview")
                .setView(wrapper)
                .setNegativeButton("Close", null)
                .setPositiveButton("Save to disk", (dialog, which) -> saveArtifact())
                .show();
    }

    private void saveArtifact() {
        try {
            File directory = new File(getExternalFilesDir(null), "artifacts");
            if (!directory.exists() && !directory.mkdirs()) throw new Exception("Could not create artifact folder");
            File file = new File(directory, "pocketmind-" + System.currentTimeMillis() + ".txt");
            try (FileWriter writer = new FileWriter(file)) {
                writer.write(lastAssistantText);
            }
            Toast.makeText(this, "Saved: " + file.getAbsolutePath(), Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "Save failed: " + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void showSettings() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(8), dp(20), 0);

        EditText endpoint = field("Chat completions URL", prefs.getString("endpoint", "https://api.openai.com/v1/chat/completions"));
        EditText apiKey = field("API key", prefs.getString("apiKey", ""));
        apiKey.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText model = field("Model", prefs.getString("model", ""));
        EditText system = field("System prompt", prefs.getString("systemPrompt", "You are a useful, direct assistant. Format answers naturally without visible Markdown syntax."));
        system.setMinLines(3);
        EditText temperature = field("Temperature (0–2)", prefs.getString("temperature", "0.7"));
        temperature.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);

        TextView reasoningLabel = label("Reasoning effort");
        Spinner reasoning = new Spinner(this);
        String[] options = {"off", "low", "medium", "high"};
        reasoning.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, options));
        String savedReasoning = prefs.getString("reasoning", "medium");
        for (int i = 0; i < options.length; i++) if (options[i].equals(savedReasoning)) reasoning.setSelection(i);

        panel.addView(endpoint);
        panel.addView(apiKey);
        panel.addView(model);
        panel.addView(system);
        panel.addView(temperature);
        panel.addView(reasoningLabel);
        panel.addView(reasoning);

        ScrollView wrapper = new ScrollView(this);
        wrapper.addView(panel);

        new AlertDialog.Builder(this)
                .setTitle("Model settings")
                .setView(wrapper)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (dialog, which) -> prefs.edit()
                        .putString("endpoint", endpoint.getText().toString().trim())
                        .putString("apiKey", apiKey.getText().toString().trim())
                        .putString("model", model.getText().toString().trim())
                        .putString("systemPrompt", system.getText().toString())
                        .putString("temperature", temperature.getText().toString().trim().isEmpty() ? "0.7" : temperature.getText().toString().trim())
                        .putString("reasoning", reasoning.getSelectedItem().toString())
                        .apply())
                .show();
    }

    private EditText field(String hint, String value) {
        EditText field = new EditText(this);
        field.setHint(hint);
        field.setText(value);
        field.setTextSize(15);
        field.setSingleLine(!hint.equals("System prompt"));
        field.setPadding(dp(4), dp(10), dp(4), dp(10));
        return field;
    }

    private TextView label(String value) {
        TextView label = new TextView(this);
        label.setText(value);
        label.setTextSize(14);
        label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        label.setPadding(0, dp(12), 0, dp(4));
        return label;
    }

    private Button compactButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(TEXT);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setBackground(makeBackground(SURFACE, 18));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(42));
        params.setMargins(dp(6), 0, 0, 0);
        button.setLayoutParams(params);
        return button;
    }

    private android.graphics.drawable.GradientDrawable makeBackground(int color, int radiusDp) {
        android.graphics.drawable.GradientDrawable drawable = new android.graphics.drawable.GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
