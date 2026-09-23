struct DisplayParameters { float4 values; }; // exposure, debug, reserved, reserved
[[vk::binding(0, 0)]] Texture2D<float4> radiance;
[[vk::binding(1, 0)]] ConstantBuffer<DisplayParameters> display;

[shader("vertex")]
float4 vertexMain(uint id : SV_VertexID) : SV_Position
{
    float2 xy = float2((id << 1) & 2, id & 2);
    return float4(xy * 2.0 - 1.0, 0.0, 1.0);
}

float3 linearToSrgb(float3 x)
{
    return select(x <= 0.0031308, 12.92 * x, 1.055 * pow(max(x, 0.0), float3(1.0 / 2.4)) - 0.055);
}

[shader("fragment")]
float4 fragmentMain(float4 position : SV_Position) : SV_Target0
{
    float3 color = radiance.Load(int3(int2(position.xy), 0)).rgb;
    if (display.values.y < 0.5) color = 1.0 - exp(-color * display.values.x);
    return float4(linearToSrgb(color), 1.0);
}
