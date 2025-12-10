import SwiftUI
import AppKit

// MARK: - Content Height Preference Key

/// PreferenceKey for bubbling up content height from SwiftUI to the panel
private struct ContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = QuickPanelWindow.minHeight
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// SwiftUI view for the Quick Panel content
/// Simplified for ticker-v2: capture mode only (no search, ask, command modes)
struct QuickPanelView: View {
    @ObservedObject var manager: QuickPanelManager
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            // Error display
            if let error = manager.error {
                errorView(error)
            }

            // Context badge (if text/image was captured)
            if let context = manager.context, context.hasContent {
                contextBadge(context: context)
            }

            // Input field
            inputField

            // Mode hints bar at bottom
            modeHintsBar
        }
        .padding(Spacing.lg)
        .frame(width: QuickPanelWindow.defaultWidth, alignment: .top)
        .fixedSize(horizontal: false, vertical: true)
        .background(Colors.windowBackground)
        .background(
            GeometryReader { geometry in
                Color.clear
                    .preference(key: ContentHeightKey.self, value: geometry.size.height)
            }
        )
        .onPreferenceChange(ContentHeightKey.self) { height in
            Task { @MainActor in
                manager.contentHeightChanged(height)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.clear, lineWidth: 1)
        )
        .onReceive(NotificationCenter.default.publisher(for: .quickPanelDidShow)) { _ in
            isInputFocused = true
        }
    }

    // MARK: - Context Badge

    private func contextBadge(context: QuickPanelContext) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: context.hasImage ? "photo" : "text.quote")
                .font(.system(size: 10))
                .foregroundColor(Colors.secondaryText)

            Text(contextPreview(context))
                .font(.system(size: 11))
                .foregroundColor(Colors.secondaryText)
                .lineLimit(1)

            Spacer()

            if let app = context.activeApp {
                Text(app)
                    .font(.system(size: 9))
                    .foregroundColor(Colors.secondaryText.opacity(0.7))
                    .padding(.horizontal, Spacing.xs)
                    .padding(.vertical, 2)
                    .background(Colors.hoverBackground)
                    .cornerRadius(Spacing.radiusSm)
            }

            // Dismiss button
            Button(action: { manager.clearContext() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundColor(Colors.secondaryText.opacity(0.6))
            }
            .buttonStyle(.plain)
            .help("Clear context")
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(Colors.userMessageBackground)
        .cornerRadius(Spacing.radiusSm)
    }

    private func contextPreview(_ context: QuickPanelContext) -> String {
        if let text = context.selectedText {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count > 40 {
                return String(trimmed.prefix(37)) + "..."
            }
            return trimmed
        }
        if context.hasImage {
            return "Image attached"
        }
        return "Context attached"
    }

    // MARK: - Input Field

    private var inputField: some View {
        HStack(spacing: Spacing.sm) {
            QuickPanelInputField(
                text: $manager.inputText,
                placeholder: placeholderText,
                isLoading: manager.isLoading,
                onSubmit: handleSubmit,
                onCancel: { manager.handleEscape() },
                onCmdEnter: handleCmdSubmit
            )

            if manager.isLoading {
                ProgressView()
                    .scaleEffect(0.6)
                    .frame(width: 16, height: 16)
            } else {
                Button(action: handleSubmit) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(canSubmit ? Colors.primaryAccent : Colors.tertiaryText.opacity(0.5))
                }
                .buttonStyle(.plain)
                .disabled(!canSubmit)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(Colors.hoverBackground)
        .cornerRadius(Spacing.radiusMd)
    }

    private var placeholderText: String {
        if manager.context?.hasContent == true {
            return "Add a note..."
        }
        return "Capture a thought..."
    }

    private var canSubmit: Bool {
        let hasInput = !manager.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasContext = manager.context?.hasContent == true
        return hasInput || hasContext
    }

    // MARK: - Mode Hints Bar

    private var modeHintsBar: some View {
        HStack(spacing: Spacing.md) {
            Text("↵ capture")
                .font(.system(size: 9))
                .foregroundColor(Colors.secondaryText.opacity(0.6))

            Text("⌘↵ AI")
                .font(.system(size: 9))
                .foregroundColor(Colors.secondaryText.opacity(0.6))

            Spacer()
        }
        .padding(.horizontal, Spacing.xs)
    }

    // MARK: - Error View

    private func errorView(_ error: String) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 10))
                .foregroundColor(Colors.errorAccent)

            Text(error)
                .font(.system(size: 11))
                .foregroundColor(Colors.errorText)
                .lineLimit(2)
        }
        .padding(Spacing.sm)
        .background(Colors.errorAccent.opacity(0.1))
        .cornerRadius(Spacing.radiusMd)
    }

    // MARK: - Actions

    private func handleSubmit() {
        guard canSubmit, !manager.isLoading else { return }
        Task {
            await manager.handleEnter()
        }
    }

    private func handleCmdSubmit() {
        guard canSubmit, !manager.isLoading else { return }
        Task {
            await manager.handleCmdEnter()
        }
    }
}

// MARK: - Quick Panel Input Field (NSTextView wrapper)

struct QuickPanelInputField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var isLoading: Bool
    var onSubmit: () -> Void
    var onCancel: () -> Void
    var onCmdEnter: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = false
        scrollView.hasHorizontalScroller = false
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder

        let textView = QuickPanelTextView()
        textView.coordinator = context.coordinator
        textView.isEditable = true
        textView.isSelectable = true
        textView.isRichText = false
        textView.allowsUndo = true
        textView.usesFontPanel = false
        textView.usesRuler = false

        // Appearance
        textView.backgroundColor = .clear
        textView.drawsBackground = false
        textView.font = NSFont.systemFont(ofSize: 15, weight: .regular)
        textView.textColor = NSColor(Colors.primaryText)

        // Text container - enable word wrapping
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.lineBreakMode = .byWordWrapping

        // Sizing behavior
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]

        // Remove focus ring and insets
        textView.focusRingType = .none
        textView.textContainerInset = NSSize(width: 0, height: 2)

        textView.string = text
        textView.delegate = context.coordinator
        context.coordinator.textView = textView
        context.coordinator.scrollView = scrollView
        context.coordinator.placeholder = placeholder

        scrollView.documentView = textView

        // Set initial placeholder
        if text.isEmpty {
            context.coordinator.showPlaceholder()
        }

        // Calculate initial height
        DispatchQueue.main.async {
            context.coordinator.updateScrollViewHeight()
            textView.window?.makeFirstResponder(textView)
        }

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? QuickPanelTextView else { return }

        context.coordinator.placeholder = placeholder
        context.coordinator.isLoading = isLoading

        // Update text if changed externally
        if !context.coordinator.isShowingPlaceholder && textView.string != text {
            textView.string = text
            DispatchQueue.main.async {
                context.coordinator.updateScrollViewHeight()
            }
        }

        // Handle placeholder visibility
        if text.isEmpty {
            if let firstResponder = textView.window?.firstResponder,
               !firstResponder.isEqual(textView) {
                context.coordinator.showPlaceholder()
            }
        }

        textView.isEditable = !isLoading
    }

    class Coordinator: NSObject, NSTextViewDelegate {
        var parent: QuickPanelInputField
        weak var textView: NSTextView?
        weak var scrollView: NSScrollView?
        var placeholder: String = ""
        var isLoading: Bool = false
        var isShowingPlaceholder: Bool = false

        init(_ parent: QuickPanelInputField) {
            self.parent = parent
        }

        func showPlaceholder() {
            guard let textView = textView, parent.text.isEmpty else { return }
            isShowingPlaceholder = true
            textView.string = placeholder
            textView.textColor = NSColor(Colors.tertiaryText)
        }

        func hidePlaceholder() {
            guard let textView = textView, isShowingPlaceholder else { return }
            isShowingPlaceholder = false
            textView.string = ""
            textView.textColor = NSColor(Colors.primaryText)
        }

        func updateScrollViewHeight() {
            guard let textView = textView,
                  let scrollView = scrollView,
                  let layoutManager = textView.layoutManager,
                  let textContainer = textView.textContainer
            else { return }

            layoutManager.ensureLayout(for: textContainer)

            var height = layoutManager.usedRect(for: textContainer).height

            if layoutManager.extraLineFragmentTextContainer != nil {
                height += layoutManager.extraLineFragmentRect.height
            }

            // Clamp height: min 22pt, max 120pt
            let finalHeight = min(max(height + 4, 22), 120)

            if let heightConstraint = scrollView.constraints.first(where: { $0.firstAttribute == .height }) {
                heightConstraint.constant = finalHeight
            } else {
                let constraint = scrollView.heightAnchor.constraint(equalToConstant: finalHeight)
                constraint.priority = .defaultHigh
                constraint.isActive = true
            }

            scrollView.invalidateIntrinsicContentSize()
            scrollView.needsLayout = true
        }

        func textDidBeginEditing(_ notification: Notification) {
            hidePlaceholder()
        }

        func textDidEndEditing(_ notification: Notification) {
            if parent.text.isEmpty {
                showPlaceholder()
            }
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }

            if !isShowingPlaceholder {
                parent.text = textView.string
            }

            updateScrollViewHeight()
        }
    }
}

// MARK: - Custom NSTextView for Quick Panel

class QuickPanelTextView: NSTextView {
    weak var coordinator: QuickPanelInputField.Coordinator?

    override func keyDown(with event: NSEvent) {
        // Clear placeholder on any typing
        if coordinator?.isShowingPlaceholder == true {
            if let chars = event.characters, !chars.isEmpty,
               event.keyCode != 53 && event.keyCode != 36 && event.keyCode != 126 && event.keyCode != 125 {
                coordinator?.hidePlaceholder()
            }
        }

        // Escape - cancel
        if event.keyCode == 53 {
            coordinator?.parent.onCancel()
            return
        }

        // Enter/Return
        if event.keyCode == 36 {
            if event.modifierFlags.contains(.command) {
                coordinator?.parent.onCmdEnter?()
                return
            }
            // Plain Enter submits
            coordinator?.parent.onSubmit()
            return
        }

        super.keyDown(with: event)
    }
}
