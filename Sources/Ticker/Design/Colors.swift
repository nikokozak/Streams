import SwiftUI

/// Color system for Quick Panel UI - adapts to light/dark mode
enum Colors {
    // MARK: - Backgrounds

    /// Main window background - adapts to appearance
    static let windowBackground = Color(NSColor.windowBackgroundColor)

    /// User message/quote background - light blue / dark blue
    static let userMessageBackground = Color(
        light: Color(red: 239/255, green: 246/255, blue: 255/255),
        dark: Color(red: 30/255, green: 41/255, blue: 59/255)
    )

    /// AI message background - subtle gray
    static let aiMessageBackground = Color(
        light: Color(red: 250/255, green: 251/255, blue: 252/255),
        dark: Color(red: 38/255, green: 38/255, blue: 38/255)
    )

    /// Hover state background - subtle gray
    static let hoverBackground = Color(
        light: Color(red: 241/255, green: 245/255, blue: 249/255),
        dark: Color(red: 45/255, green: 45/255, blue: 45/255)
    )

    // MARK: - Text Colors

    /// Primary text color - adapts to appearance
    static let primaryText = Color(NSColor.labelColor)

    /// Secondary text color - adapts to appearance
    static let secondaryText = Color(NSColor.secondaryLabelColor)

    /// Tertiary text color - adapts to appearance
    static let tertiaryText = Color(NSColor.tertiaryLabelColor)

    /// Error text color
    static let errorText = Color(red: 239/255, green: 68/255, blue: 68/255)

    // MARK: - Accent Colors

    /// Primary accent - blue
    static let primaryAccent = Color(red: 59/255, green: 130/255, blue: 246/255)

    /// Success accent - green
    static let successAccent = Color(red: 34/255, green: 197/255, blue: 94/255)

    /// Warning accent - amber
    static let warningAccent = Color(red: 251/255, green: 191/255, blue: 36/255)

    /// Error accent - red
    static let errorAccent = Color(red: 239/255, green: 68/255, blue: 68/255)
}

// MARK: - Color Extension for Light/Dark Mode

extension Color {
    /// Creates a color that adapts to light and dark appearance
    init(light: Color, dark: Color) {
        self.init(NSColor(name: nil, dynamicProvider: { appearance in
            switch appearance.bestMatch(from: [.aqua, .darkAqua]) {
            case .darkAqua:
                return NSColor(dark)
            default:
                return NSColor(light)
            }
        }))
    }
}
