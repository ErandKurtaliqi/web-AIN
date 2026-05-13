using Microsoft.AspNetCore.SignalR;
using SchedulingAPI.Models;

namespace SchedulingAPI.Hubs;

/// <summary>
/// SignalR hub for real-time scheduling updates.
/// Clients join a group named after the instance they are watching.
/// The server broadcasts StatusMessage events to that group.
/// </summary>
public class ScheduleHub : Hub
{
    /// <summary>Join the broadcast group for a specific instance.</summary>
    public async Task JoinInstanceGroup(string instanceName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, instanceName);
    }

    /// <summary>Leave a broadcast group.</summary>
    public async Task LeaveInstanceGroup(string instanceName)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, instanceName);
    }

    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await base.OnDisconnectedAsync(exception);
    }
}
