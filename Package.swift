// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Ticker",
    platforms: [
        .macOS(.v14)  // Required for MLX Swift
    ],
    products: [
        .executable(name: "Ticker", targets: ["Ticker"])
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.24.0"),
        .package(url: "https://github.com/ml-explore/mlx-swift-lm/", from: "2.29.2")
    ],
    targets: [
        .executableTarget(
            name: "Ticker",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "MLXLLM", package: "mlx-swift-lm")
            ],
            resources: [
                .copy("Resources")
            ]
        )
    ]
)
