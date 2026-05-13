using Microsoft.AspNetCore.Mvc;
using SchedulingAPI.Models;
using SchedulingAPI.Services;

namespace SchedulingAPI.Controllers;

[ApiController]
[Route("api/schedule")]
public class ScheduleController(PythonSchedulerService scheduler, ILogger<ScheduleController> logger) : ControllerBase
{
    /// <summary>
    /// Start a streaming run.
    /// Returns 202 immediately; live progress + final result are pushed via SignalR.
    /// </summary>
    [HttpPost("run")]
    public IActionResult Run([FromBody] RunRequest request)
    {
        try
        {
            scheduler.StartStreamRunAsync(request, instanceGroup: request.Instance);
            return Accepted(new { started = true, instance = request.Instance });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to start streaming run");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>Cancel a running algorithm for the given instance group.</summary>
    [HttpDelete("cancel/{instanceGroup}")]
    public IActionResult Cancel(string instanceGroup)
    {
        var cancelled = scheduler.CancelRun(instanceGroup);
        return cancelled
            ? Ok(new { cancelled = true })
            : NotFound(new { error = $"No running job for '{instanceGroup}'" });
    }

    /// <summary>Run multiple configurations and return a side-by-side comparison.</summary>
    [HttpPost("compare")]
    public async Task<ActionResult<CompareResult>> Compare([FromBody] CompareRequest request)
    {
        try
        {
            var result = await scheduler.CompareAsync(request, instanceGroup: request.Instance);
            return Ok(result);
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = "Python scheduling service is unavailable", detail = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>List available instance files from the Python service.</summary>
    [HttpGet("instances")]
    public async Task<ActionResult<object>> GetInstances()
    {
        try
        {
            var result = await scheduler.GetInstancesAsync();
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }

    /// <summary>Get metadata for a specific instance.</summary>
    [HttpGet("instance-info/{instanceName}")]
    public async Task<ActionResult<object>> GetInstanceInfo(string instanceName)
    {
        try
        {
            var result = await scheduler.GetInstanceInfoAsync(instanceName);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(503, new { error = ex.Message });
        }
    }
}
