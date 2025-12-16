import SwiftUI
import ApplicationServices

/// Onboarding view shown on first launch
struct OnboardingView: View {
    @State private var step: OnboardingStep = .welcome
    @State private var apiKey = ""
    @State private var selectedProvider: APIProvider = .openai
    @State private var hasAccessibility = false
    @State private var isSaving = false

    var onComplete: () -> Void

    enum OnboardingStep {
        case welcome
        case accessibility
        case apiKey
        case complete
    }

    enum APIProvider: String, CaseIterable {
        case openai = "OpenAI"
        case anthropic = "Anthropic"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Progress indicator
            HStack(spacing: 8) {
                ForEach(0..<4, id: \.self) { index in
                    Circle()
                        .fill(stepIndex >= index ? Color.accentColor : Color.gray.opacity(0.3))
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 32)

            // Step content
            Group {
                switch step {
                case .welcome:
                    welcomeStep
                case .accessibility:
                    accessibilityStep
                case .apiKey:
                    apiKeyStep
                case .complete:
                    completeStep
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(width: 420, height: 380)
        .padding(.horizontal, 32)
        .padding(.bottom, 24)
    }

    private var stepIndex: Int {
        switch step {
        case .welcome: return 0
        case .accessibility: return 1
        case .apiKey: return 2
        case .complete: return 3
        }
    }

    // MARK: - Welcome Step

    private var welcomeStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "text.quote")
                .font(.system(size: 56))
                .foregroundColor(.accentColor)

            Text("Welcome to Ticker")
                .font(.system(size: 24, weight: .semibold))

            Text("A research companion that captures and connects your thoughts.")
                .font(.system(size: 14))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Spacer()

            Button("Get Started") {
                withAnimation { step = .accessibility }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }

    // MARK: - Accessibility Step

    private var accessibilityStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "hand.raised.fill")
                .font(.system(size: 48))
                .foregroundColor(.orange)

            Text("Accessibility Permission")
                .font(.system(size: 20, weight: .semibold))

            Text("Ticker needs Accessibility permission to capture text selections when you press Cmd+L.")
                .font(.system(size: 13))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if hasAccessibility {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("Permission granted")
                        .foregroundColor(.green)
                }
                .font(.system(size: 14, weight: .medium))
            } else {
                Button("Open System Settings") {
                    requestAccessibility()
                }
                .buttonStyle(.bordered)
            }

            Spacer()

            HStack(spacing: 12) {
                Button("Skip") {
                    withAnimation { step = .apiKey }
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)

                Button("Continue") {
                    withAnimation { step = .apiKey }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!hasAccessibility)
            }
        }
        .onAppear { checkAccessibility() }
    }

    // MARK: - API Key Step

    private var apiKeyStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "key.fill")
                .font(.system(size: 48))
                .foregroundColor(.accentColor)

            Text("Add an API Key")
                .font(.system(size: 20, weight: .semibold))

            Text("Choose your AI provider and enter your API key to enable AI features.")
                .font(.system(size: 13))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Picker("Provider", selection: $selectedProvider) {
                ForEach(APIProvider.allCases, id: \.self) { provider in
                    Text(provider.rawValue).tag(provider)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            SecureField("API Key", text: $apiKey)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

            if selectedProvider == .openai {
                Link("Get an OpenAI API key", destination: URL(string: "https://platform.openai.com/api-keys")!)
                    .font(.system(size: 12))
            } else {
                Link("Get an Anthropic API key", destination: URL(string: "https://console.anthropic.com/settings/keys")!)
                    .font(.system(size: 12))
            }

            Spacer()

            HStack(spacing: 12) {
                Button("Skip") {
                    withAnimation { step = .complete }
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)

                Button("Save & Continue") {
                    saveAPIKey()
                }
                .buttonStyle(.borderedProminent)
                .disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
            }
        }
    }

    // MARK: - Complete Step

    private var completeStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundColor(.green)

            Text("You're all set!")
                .font(.system(size: 24, weight: .semibold))

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "command")
                        .frame(width: 20)
                    Text("Cmd+L")
                        .fontWeight(.medium)
                    Text("Open Quick Panel anywhere")
                        .foregroundColor(.secondary)
                }

                HStack(spacing: 8) {
                    Image(systemName: "command")
                        .frame(width: 20)
                    Text("Cmd+;")
                        .fontWeight(.medium)
                    Text("Capture a screenshot")
                        .foregroundColor(.secondary)
                }
            }
            .font(.system(size: 13))
            .padding()
            .background(Color.gray.opacity(0.1))
            .cornerRadius(8)

            Spacer()

            Button("Start Using Ticker") {
                SettingsService.shared.hasCompletedOnboarding = true
                onComplete()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }

    // MARK: - Actions

    private func checkAccessibility() {
        hasAccessibility = AXIsProcessTrusted()
    }

    private func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
        AXIsProcessTrustedWithOptions(options)

        // Poll for permission change
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
            if AXIsProcessTrusted() {
                hasAccessibility = true
                timer.invalidate()
            }
        }
    }

    private func saveAPIKey() {
        isSaving = true
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespaces)

        switch selectedProvider {
        case .openai:
            SettingsService.shared.openaiAPIKey = trimmedKey
        case .anthropic:
            SettingsService.shared.anthropicAPIKey = trimmedKey
        }

        isSaving = false
        withAnimation { step = .complete }
    }
}
