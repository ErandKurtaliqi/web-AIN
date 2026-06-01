using SchedulingAPI.Hubs;
using SchedulingAPI.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Configuration ─────────────────────────────────────────────────────────────
var pythonApiUrl = builder.Configuration["PythonApiUrl"] ?? "http://localhost:8000";
var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
                     ?? ["http://localhost:4200"];

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        o.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });

builder.Services.AddSignalR();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();   // required for SignalR
    });
});

// Register the Python scheduler service with a typed HttpClient
builder.Services.AddHttpClient<PythonSchedulerService>(client =>
{
    client.BaseAddress = new Uri(pythonApiUrl);
    client.Timeout = TimeSpan.FromMinutes(10);  // allow long optimisation runs
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ── App pipeline ──────────────────────────────────────────────────────────────
var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseCors("AllowAngular");

app.MapControllers();
app.MapHub<ScheduleHub>("/hubs/schedule");

// Simple health-check endpoint
app.MapGet("/health", () => Results.Ok(new { status = "ok", pythonApi = pythonApiUrl }));

app.Run();
