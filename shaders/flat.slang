import camera;

[[vk::binding(0, 0)]] ConstantBuffer<FrameParameters> frame;
[[vk::binding(1, 0)]] WTexture2D<float4> radiance;
[[vk::binding(2, 0)]] RWStructuredBuffer<float4> directions;

float3 gridSky(float3 d)
{
    const float pi = 3.141592653589793;
    float longitude = atan2(d.z, d.x);
    float latitude = asin(clamp(d.y, -1.0, 1.0));
    float2 cell = float2(longitude, latitude) * (18.0 / pi);
    float2 edge = abs(frac(cell + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.018, 0.045, min(edge.x, edge.y));
    float checker = fmod(abs(floor(cell.x) + floor(cell.y)), 2.0);
    float3 color = lerp(float3(0.035, 0.065, 0.10), float3(0.085, 0.13, 0.18), checker);
    color = lerp(color, float3(0.4, 0.6, 0.7), line);
    // Axis caps: X red, Y green, Z blue. Positive brighter than negative.
    float3 ad = abs(d);
    if (max(ad.x, max(ad.y, ad.z)) > 0.998)
    {
        if (ad.x > ad.y && ad.x > ad.z) color = float3(d.x > 0 ? 3.0 : 0.6, 0.08, 0.08);
        else if (ad.y > ad.z) color = float3(0.08, d.y > 0 ? 3.0 : 0.6, 0.08);
        else color = float3(0.08, 0.18, d.z > 0 ? 3.0 : 0.6);
    }
    return color;
}

[shader("compute")]
[numthreads(8, 8, 1)]
void flatMain(uint3 id : SV_DispatchThreadID)
{
    uint2 size = uint2(frame.viewport.xy);
    if (id.x >= size.x || id.y >= size.y) return;
    float3 direction = cameraDirection(frame, id.xy);
    directions[id.y * size.x + id.x] = float4(direction, 1.0); // escaped=1
    float3 color = frame.viewport.w > 0.5 ? direction * 0.5 + 0.5 : gridSky(direction);
    radiance.Store(id.xy, float4(color, 1.0));
}
