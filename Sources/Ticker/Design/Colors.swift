import SwiftUI

/// Color system for Quick Panel UI
enum Colors {
    // MARK: - Backgrounds

    /// Main window background - solid white
    static let windowBackground = Color.white

    /// User message/quote background - light blue
    static let userMessageBackground = Color(red: 239/255, green: 246/255, blue: 255/255)

    /// AI message background - very light gray
    static let aiMessageBackground = Color(red: 250/255, green: 251/255, blue: 252/255)

    /// Hover state background - subtle light gray
    static let hoverBackground = Color(red: 241/255, green: 245/255, blue: 249/255)

    // MARK: - Text Colors

    /// Primary text color - dark slate
    static let primaryText = Color(red: 30/255, green: 41/255, blue: 59/255)

    /// Secondary text color - medium slate
    static let secondaryText = Color(red: 100/255, green: 116/255, blue: 139/255)

    /// Tertiary text color - light slate
    static let tertiaryText = Color(red: 100/255, green: 116/255, blue: 139/255)

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
