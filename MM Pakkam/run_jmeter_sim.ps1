$code = @"
using System;
using System.Diagnostics;
using System.Net.Http;
using System.Threading.Tasks;
using System.Collections.Concurrent;
using System.Linq;

public class LoadTester {
    public static async Task RunTest(string url, int totalRequests) {
        var httpClient = new HttpClient();
        var results = new ConcurrentBag<long>();
        var errors = new ConcurrentBag<string>();
        var tasks = new Task[totalRequests];
        
        Stopwatch totalTimer = Stopwatch.StartNew();

        for (int i = 0; i < totalRequests; i++) {
            tasks[i] = Task.Run(async () => {
                var sw = Stopwatch.StartNew();
                try {
                    var response = await httpClient.GetAsync(url);
                    response.EnsureSuccessStatusCode();
                    sw.Stop();
                    results.Add(sw.ElapsedMilliseconds);
                } catch (Exception ex) {
                    sw.Stop();
                    errors.Add(ex.Message);
                }
            });
        }
        
        await Task.WhenAll(tasks);
        totalTimer.Stop();
        
        var times = results.OrderBy(t => t).ToList();
        
        Console.WriteLine("--- LOAD TEST RESULTS ---");
        Console.WriteLine("Test Completed.");
        Console.WriteLine(string.Format("Total Requests: {0}", totalRequests));
        Console.WriteLine(string.Format("Successful: {0}", results.Count));
        Console.WriteLine(string.Format("Failed: {0}", errors.Count));
        Console.WriteLine(string.Format("Total Time: {0} ms", totalTimer.ElapsedMilliseconds));
        
        if (times.Count > 0) {
            Console.WriteLine(string.Format("Min Time: {0} ms", times.First()));
            Console.WriteLine(string.Format("Max Time: {0} ms", times.Last()));
            Console.WriteLine(string.Format("Average Time: {0} ms", Math.Round(times.Average(), 2)));
            
            // 90th percentile
            int p90Index = (int)Math.Floor(times.Count * 0.90);
            if (p90Index >= times.Count) p90Index = times.Count - 1;
            Console.WriteLine(string.Format("90th Percentile: {0} ms", times[p90Index]));

            // 95th percentile
            int p95Index = (int)Math.Floor(times.Count * 0.95);
            if (p95Index >= times.Count) p95Index = times.Count - 1;
            Console.WriteLine(string.Format("95th Percentile: {0} ms", times[p95Index]));
        }
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies "System.Net.Http"
[LoadTester]::RunTest("https://mmpakkam.web.app", 100).GetAwaiter().GetResult()
