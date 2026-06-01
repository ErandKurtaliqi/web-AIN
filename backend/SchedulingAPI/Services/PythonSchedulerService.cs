using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using SchedulingAPI.Hubs;
using SchedulingAPI.Models;

namespace SchedulingAPI.Services;

/// <summary>
/// Calls the Python FastAPI microservice and broadcasts results via SignalR.
/// All algorithm logic lives in Python — this service is a thin HTTP proxy.
/// </summary>
public class PythonSchedulerService(
    HttpClient httpClient,
    IHubContext<ScheduleHub> hubContext,
    ILogger<PythonSchedulerService> logger)
{
    // ── Cancellation map (one per instance group) ─────────────────────────
    private static readonly ConcurrentDictionary<string, CancellationTokenSource> _running = new();

    // ── Streaming run (real-time) ─────────────────────────────────────────

    /// <summary>
    /// Starts a streaming run in the background.
    /// Progress snapshots and the final result are pushed to the SignalR group.
    /// Returns immediately so the controller can respond 202.
    /// </summary>
    public Task StartStreamRunAsync(RunRequest request, string instanceGroup)
    {
        // Cancel any previous run for this group
        if (_running.TryRemove(instanceGroup, out var old))
            old.Cancel();

        var cts = new CancellationTokenSource();
        _running[instanceGroup] = cts;

        // Fire-and-forget; exceptions are caught inside
        _ = StreamRunAsync(request, instanceGroup, cts.Token);
        return Task.CompletedTask;
    }

    public bool CancelRun(string instanceGroup)
    {
        if (_running.TryRemove(instanceGroup, out var cts))
        {
            cts.Cancel();
            return true;
        }
        return false;
    }

    private async Task StreamRunAsync(RunRequest request, string instanceGroup, CancellationToken ct)
    {
        await NotifyAsync(instanceGroup, "running", "Algorithm is running…");

        try
        {
            var pythonReq = MapRunRequest(request);
            using var httpReq = new HttpRequestMessage(HttpMethod.Post, "/run-stream")
            {
                Content = JsonContent.Create(pythonReq)
            };

            using var response = await httpClient.SendAsync(
                httpReq, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var reader = new StreamReader(stream);

            while (!reader.EndOfStream && !ct.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(ct);
                if (string.IsNullOrWhiteSpace(line)) continue;
                if (!line.StartsWith("data:")) continue;

                var json = line["data:".Length..].Trim();
                if (string.IsNullOrEmpty(json)) continue;

                using var doc = JsonDocument.Parse(json);
                var type = doc.RootElement.TryGetProperty("type", out var typeProp)
                    ? typeProp.GetString()
                    : null;

                switch (type)
                {
                    case "progress":
                    {
                        var iteration = doc.RootElement.GetProperty("iteration").GetInt32();
                        var score     = doc.RootElement.GetProperty("score").GetDouble();
                        var currentScore = doc.RootElement.TryGetProperty("current_score", out var currentProp)
                            ? currentProp.GetDouble()
                            : score;
                        var bestScore = doc.RootElement.TryGetProperty("best_score", out var bestProp)
                            ? bestProp.GetDouble()
                            : score;
                        await hubContext.Clients.Group(instanceGroup)
                            .SendAsync("ProgressUpdate", new { iteration, score, currentScore, bestScore }, ct);
                        break;
                    }

                    case "result":
                    {
                        // Use PythonIn to correctly map snake_case keys from Python
                        var result = JsonSerializer.Deserialize<ScheduleResult>(json, JsonOptions.PythonIn);
                        await NotifyAsync(instanceGroup, "completed", "Run completed", result);
                        break;
                    }

                    case "error":
                    {
                        var msg = doc.RootElement.TryGetProperty("message", out var mp)
                            ? mp.GetString() ?? "Unknown error"
                            : "Unknown error";
                        await NotifyAsync(instanceGroup, "error", msg);
                        break;
                    }

                    case "cancelled":
                        await NotifyAsync(instanceGroup, "cancelled", "Run stopped by user");
                        break;
                }
            }

            if (ct.IsCancellationRequested)
                await NotifyAsync(instanceGroup, "cancelled", "Run stopped by user");
        }
        catch (OperationCanceledException)
        {
            await NotifyAsync(instanceGroup, "cancelled", "Run stopped by user");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error in streaming run for {Group}", instanceGroup);
            await NotifyAsync(instanceGroup, "error", ex.Message);
        }
        finally
        {
            _running.TryRemove(instanceGroup, out _);
        }
    }

    // ── Compare ──────────────────────────────────────────────────────────────

    public async Task<CompareResult> CompareAsync(CompareRequest request, string? instanceGroup = null)
    {
        await NotifyAsync(instanceGroup, "running", "Comparing configurations…");

        try
        {
            var pythonRequest = new
            {
                instance = request.Instance,
                configurations = request.Configurations.Select(c => new
                {
                    label = c.Label,
                    operators = c.Operators,
                    max_iterations = c.MaxIterations,
                    num_restarts = c.NumRestarts,
                    insertion_interval = c.InsertionInterval,
                    max_shift = c.MaxShift,
                    max_execution_seconds = c.MaxExecutionSeconds,
                })
            };

            var response = await httpClient.PostAsJsonAsync("/compare", pythonRequest);
            response.EnsureSuccessStatusCode();

            var result = await response.Content.ReadFromJsonAsync<CompareResult>(JsonOptions.PythonIn)
                         ?? throw new InvalidOperationException("Empty compare response");

            await NotifyAsync(instanceGroup, "completed", "Comparison completed");
            return result;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error calling Python /compare endpoint");
            await NotifyAsync(instanceGroup, "error", ex.Message);
            throw;
        }
    }

    // ── Instances / metadata ─────────────────────────────────────────────────

    public async Task<object?> GetInstancesAsync()
    {
        var response = await httpClient.GetAsync("/instances");
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<object>(JsonOptions.Web);
    }

    public async Task<object?> GetInstanceInfoAsync(string instanceName)
    {
        var response = await httpClient.GetAsync($"/instance-info/{instanceName}");
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<object>(JsonOptions.Web);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async Task NotifyAsync(string? group, string status, string message, ScheduleResult? result = null)
    {
        if (group is null) return;
        var msg = new StatusMessage { Status = status, Message = message, Result = result };
        await hubContext.Clients.Group(group).SendAsync("ScheduleUpdate", msg);
    }

    private static object MapRunRequest(RunRequest req) => new
    {
        instance = req.Instance,
        algorithm = req.Algorithm,
        operators = req.Operators,
        max_iterations = req.MaxIterations,
        num_restarts = req.NumRestarts,
        insertion_interval = req.InsertionInterval,
        max_shift = req.MaxShift,
        max_execution_seconds = req.MaxExecutionSeconds,
    };
}

/// <summary>
/// Shared JSON serializer options.
/// PythonIn   – reads Python's snake_case keys into C# PascalCase properties.
/// Web        – used by SignalR and HTTP responses; outputs camelCase to Angular.
/// </summary>
internal static class JsonOptions
{
    /// <summary>Deserialise Python snake_case JSON into C# models.</summary>
    public static readonly JsonSerializerOptions PythonIn = new()
    {
        PropertyNamingPolicy        = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>General web defaults (camelCase output, case-insensitive input).</summary>
    public static readonly JsonSerializerOptions Web =
        new(JsonSerializerDefaults.Web);
}
