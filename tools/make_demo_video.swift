// Makes a short stand-in product video (H.264 MP4) and its poster from a still image: a slow push-in
// across the artwork. Used only for demo media until real product films exist.
// Run: swift tools/make_demo_video.swift <input image> <output.mp4> <poster.jpg> [seconds]
import AVFoundation
import AppKit
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 4 else { print("usage: make_demo_video.swift input.png output.mp4 poster.jpg [seconds]"); exit(1) }
let seconds = args.count > 4 ? Double(args[4]) ?? 6 : 6
let width = 960, height = 1200, fps: Int32 = 24
guard let nsImage = NSImage(contentsOfFile: args[1]),
      let image = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("cannot read \(args[1])"); exit(1) }

let output = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: output)
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_800_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel]])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

// Draw one frame: the image covers the frame, scaled from 1.0x to 1.18x with a gentle drift, on near-black.
func render(_ t: Double, into context: CGContext) {
    context.setFillColor(CGColor(gray: 0.04, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let eased = t * t * (3 - 2 * t)
    let cover = max(Double(width) / Double(image.width), Double(height) / Double(image.height))
    let scale = cover * (1.0 + 0.18 * eased)
    let w = Double(image.width) * scale, h = Double(image.height) * scale
    let x = (Double(width) - w) / 2 - 40 * eased, y = (Double(height) - h) / 2 + 30 * eased
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: x, y: y, width: w, height: h))
}

let frames = Int(seconds * Double(fps))
var poster: CGImage?
for frame in 0..<frames {
    while !input.isReadyForMoreMediaData { usleep(2000) }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    guard let pixels = buffer else { exit(1) }
    CVPixelBufferLockBaseAddress(pixels, [])
    let context = CGContext(data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    // A loop should return to its start: push in for the first half, ease back out for the second.
    let phase = Double(frame) / Double(frames - 1)
    render(phase < 0.5 ? phase * 2 : (1 - phase) * 2, into: context)
    if frame == 0 { poster = context.makeImage() }
    CVPixelBufferUnlockBaseAddress(pixels, [])
    adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { print("failed: \(String(describing: writer.error))"); exit(1) }

let rep = NSBitmapImageRep(cgImage: poster!)
try rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85])!.write(to: URL(fileURLWithPath: args[3]))
let bytes = (try FileManager.default.attributesOfItem(atPath: args[2])[.size] as? Int) ?? 0
print("Wrote \(args[2]) (\(frames) frames, \(String(format: "%.1f", Double(bytes) / 1_048_576)) MB) and \(args[3])")
