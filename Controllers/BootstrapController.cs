using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using InvoicesErp.DTOs;
using InvoicesErp.Services;
using Microsoft.AspNetCore.Mvc;
using InvoicesErp.Auth;

namespace InvoicesErp.Controllers;

[ApiController]
[Route("api/bootstrap")]
public class BootstrapController(InvoicesErp.Interfaces.IBootstrapService service) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            AllowTrailingCommas = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        options.Converters.Add(new FlexibleDateTimeConverter());
        options.Converters.Add(new FlexibleNullableDateTimeConverter());
        options.Converters.Add(new FlexibleStringArrayConverter());
        return options;
    }

    [HttpGet]
    [RequireAuth]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var data = await service.GetAsync(ct);
        return Ok(data);
    }

    // بعض الواجهات تبعت POST بدل PUT
    [HttpPut]
    [HttpPost]
    [RequireAuth]
    public async Task<IActionResult> Replace(
        [FromBody] JsonElement payload,
        [FromQuery] string? mode = null,
        CancellationToken ct = default)
    {
        // Full-state sync: Admin, import/export managers, or any user with at least one write permission.
        // View-only users are rejected (403).
        var user = HttpContext.Items["AppUser"] as AppUser;
        var authService = HttpContext.RequestServices.GetRequiredService<InvoicesErp.Interfaces.IAuthService>();
        if (user is null)
            return Unauthorized(new { success = false, message = "غير مصرح. يرجى تسجيل الدخول." });
        var canWrite = string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase)
            || authService.HasPermission(user, PermissionModules.ImportExport, PermissionActions.Manage)
            || authService.HasPermission(user, PermissionModules.ImportExport, PermissionActions.Export)
            || PermissionModules.All.Any(m =>
                authService.HasPermission(user, m, PermissionActions.Create)
                || authService.HasPermission(user, m, PermissionActions.Edit)
                || authService.HasPermission(user, m, PermissionActions.Delete));
        if (!canWrite)
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                message = "ليس لديك صلاحية لتعديل البيانات (عرض فقط)."
            });

        if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Bootstrap payload is empty."
            });
        }

        if (payload.ValueKind != JsonValueKind.Object)
        {
            return BadRequest(new
            {
                success = false,
                message = "Bootstrap payload must be a JSON object.",
                receivedKind = payload.ValueKind.ToString()
            });
        }

        BootstrapDto? dto;
        var raw = payload.GetRawText();

        try
        {
            dto = JsonSerializer.Deserialize<BootstrapDto>(raw, JsonOptions);
        }
        catch (JsonException ex)
        {
            return BadRequest(new
            {
                success = false,
                message = "Invalid bootstrap JSON.",
                error = ex.Message,
                path = ex.Path,
                lineNumber = ex.LineNumber,
                bytePositionInLine = ex.BytePositionInLine,
                // أول 1500 حرف للمساعدة في التشخيص
                payloadPreview = raw.Length <= 1500 ? raw : raw[..1500]
            });
        }

        if (dto is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Bootstrap payload could not be deserialized."
            });
        }

        try
        {
            if (string.Equals(mode, "upsert", StringComparison.OrdinalIgnoreCase))
            {
                await service.UpsertAsync(dto, ct);
            }
            else
            {
                await service.ReplaceAsync(dto, ct);
            }
            return Ok(new
            {
                success = true,
                message = string.Equals(mode, "upsert", StringComparison.OrdinalIgnoreCase)
                    ? "تم حفظ البيانات بنجاح (upsert)."
                    : "تم حفظ البيانات بنجاح."
            });
        }
        catch (ArgumentException ex)
        {
            Console.Error.WriteLine($"[Bootstrap] Validation error: {ex.Message}");
            return BadRequest(new
            {
                success = false,
                message = $"فشل التحقق من البيانات: {ex.Message}"
            });
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateException dbEx)
        {
            var innerMsg = dbEx.InnerException?.Message ?? dbEx.Message;
            Console.Error.WriteLine($"[Bootstrap] DB error: {innerMsg}");
            return BadRequest(new
            {
                success = false,
                message = $"خطأ في قاعدة البيانات: لا يمكن حفظ البيانات. تأكد من صحة البيانات والمراجع.\nالتفاصيل: {innerMsg}"
            });
        }
        catch (Exception ex)
        {
            var innerMsg = ex.InnerException?.Message ?? ex.Message;
            Console.Error.WriteLine($"[Bootstrap] Unexpected error: {innerMsg}");
            Console.Error.WriteLine($"[Bootstrap] Stack: {ex.StackTrace}");
            return BadRequest(new
            {
                success = false,
                message = $"فشل حفظ البيانات: {innerMsg}",
                error = ex.Message,
                inner = ex.InnerException?.Message
            });
        }
    }
}

/// <summary>
/// يقبل تواريخ بصيغ متعددة شائعة من الـ Frontend
/// </summary>
file sealed class FlexibleDateTimeConverter : JsonConverter<DateTime>
{
    private static readonly string[] Formats =
    [
        "yyyy-MM-dd",
        "yyyy-MM-ddTHH:mm:ss",
        "yyyy-MM-ddTHH:mm:ss.fff",
        "yyyy-MM-ddTHH:mm:ssZ",
        "yyyy-MM-ddTHH:mm:ss.fffZ",
        "yyyy-MM-ddTHH:mm:ss.fffffffZ",
        "dd/MM/yyyy",
        "MM/dd/yyyy"
    ];

    public override DateTime Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return default;

        if (reader.TokenType == JsonTokenType.String)
        {
            var s = reader.GetString();
            if (string.IsNullOrWhiteSpace(s))
                return default;

            if (DateTime.TryParseExact(
                    s,
                    Formats,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var exact))
                return exact;

            if (DateTime.TryParse(
                    s,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var parsed))
                return parsed;

            throw new JsonException($"Invalid date format: '{s}'");
        }

        if (reader.TokenType == JsonTokenType.Number &&
            reader.TryGetInt64(out var epoch))
        {
            // دعم epoch milliseconds لو الـ frontend بيبعت رقم
            if (epoch > 10_000_000_000)
                return DateTimeOffset.FromUnixTimeMilliseconds(epoch).UtcDateTime;

            return DateTimeOffset.FromUnixTimeSeconds(epoch).UtcDateTime;
        }

        throw new JsonException($"Unexpected token for DateTime: {reader.TokenType}");
    }

    public override void Write(
        Utf8JsonWriter writer,
        DateTime value,
        JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
    }
}

file sealed class FlexibleNullableDateTimeConverter : JsonConverter<DateOnly?>
{
    private readonly FlexibleDateTimeConverter _inner = new();

    public override DateOnly? Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return null;

        if (reader.TokenType == JsonTokenType.String)
        {
            var s = reader.GetString();
            if (string.IsNullOrWhiteSpace(s))
                return null;
        }

        return DateOnly.FromDateTime(_inner.Read(ref reader, typeof(DateTime), options));
    }

    public override void Write(
        Utf8JsonWriter writer,
        DateOnly? value,
        JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        writer.WriteStringValue(value.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }
}
file sealed class FlexibleStringArrayConverter : JsonConverter<string[]?>
{
    public override string[]? Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return null;

        if (reader.TokenType == JsonTokenType.StartArray)
        {
            using var document = JsonDocument.ParseValue(ref reader);
            var values = new List<string>();

            foreach (var item in document.RootElement.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                {
                    var value = item.GetString();
                    if (!string.IsNullOrWhiteSpace(value))
                        values.Add(value);
                }
                else if (item.ValueKind != JsonValueKind.Null)
                {
                    values.Add(item.ToString());
                }
            }

            return values.ToArray();
        }

        if (reader.TokenType == JsonTokenType.String)
        {
            var value = reader.GetString();
            if (string.IsNullOrWhiteSpace(value))
                return [];

            return value
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }

        throw new JsonException($"Unexpected token for string[]: {reader.TokenType}");
    }

    public override void Write(
        Utf8JsonWriter writer,
        string[]? value,
        JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        writer.WriteStartArray();
        foreach (var item in value)
            writer.WriteStringValue(item);
        writer.WriteEndArray();
    }
}
