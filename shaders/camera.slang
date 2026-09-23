// Shared ABI: five float4 slots, 80 bytes; no implicit float3 padding.
struct FrameParameters
{
    float4 position;
    float4 forward;
    float4 right;
    float4 up;
    float4 viewport; // width, height, tan(verticalFov/2), debug mode
};

float3 cameraDirection(FrameParameters frame, uint2 pixel)
{
    float2 uv = (float2(pixel) + 0.5) / frame.viewport.xy;
    float2 screen = float2(2.0 * uv.x - 1.0, 1.0 - 2.0 * uv.y);
    return normalize(frame.forward.xyz
        + frame.right.xyz * screen.x * (frame.viewport.x / frame.viewport.y) * frame.viewport.z
        + frame.up.xyz * screen.y * frame.viewport.z);
}
