import re

with open('report.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace the Trend Data generation logic safely
old_logic = '''            // 2. Prepare Trend Data (Group by Date)
            const dateMap = {};
            data.forEach(r => {
                if (!r.date) return;
                if (!dateMap[r.date]) dateMap[r.date] = { sales: 0, purchases: 0 };
                if (r.type === 'sales') dateMap[r.date].sales += r.total;
                if (r.type === 'purchase') dateMap[r.date].purchases += r.total;
            });

            const sortedDates = Object.keys(dateMap).sort();
            const labels = sortedDates.map(formatDate);
            const salesData = sortedDates.map(d => dateMap[d].sales);
            const profitData = sortedDates.map(d => dateMap[d].sales - dateMap[d].purchases);'''

new_logic = '''            // 2. Prepare Trend Data (Group by Date)
            const dateMap = {};
            data.forEach(r => {
                if (!r.date) return;
                if (!dateMap[r.date]) dateMap[r.date] = { sales: 0, cogs: 0, purchases: 0 };
                
                if (r.type === 'sales') {
                    dateMap[r.date].sales += r.total;
                    
                    let costPerUnit = 0;
                    const match = purchases.find(p => (p.product_name || p.productName || '').toLowerCase() === (r.product || '').toLowerCase());
                    if (match) {
                        const pRate = parseFloat(match.rate) || 0;
                        const pPack = parseFloat(match.pack) || 1;
                        const pGst = parseFloat(match.gst) || 0;
                        costPerUnit = (pRate / pPack) * (1 + (pGst / 100));
                    }
                    dateMap[r.date].cogs += (costPerUnit * r.qty);
                }
                
                if (r.type === 'purchase') dateMap[r.date].purchases += r.total;
            });

            const sortedDates = Object.keys(dateMap).sort();
            const labels = sortedDates.map(formatDate);
            const salesData = sortedDates.map(d => dateMap[d].sales);
            const profitData = sortedDates.map(d => dateMap[d].sales - dateMap[d].cogs);'''

content = content.replace(old_logic, new_logic)

# 2. Replace the Chart rendering logic safely
old_chart = '''            // Render Trend Chart
            const ctxTrend = document.getElementById('trendChart');
            if (ctxTrend) {
                if (trendChartInstance) trendChartInstance.destroy();
                trendChartInstance = new Chart(ctxTrend, {
                    type: 'line',
                    data: {
                        labels: labels.length ? labels : ['No Data'],
                        datasets: [
                            {
                                label: 'Revenue (?)',
                                data: salesData.length ? salesData : [0],
                                borderColor: '#0ea5e9',
                                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                                borderWidth: 3,
                                fill: true,
                                tension: 0.4
                            },
                            {
                                label: 'Est. Net Profit (?)',
                                data: profitData.length ? profitData : [0],
                                borderColor: '#10b981',
                                backgroundColor: 'transparent',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                tension: 0.4
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'top' } },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }'''

new_chart = '''            // Render Trend Chart
            const ctxTrend = document.getElementById('trendChart');
            if (ctxTrend) {
                if (trendChartInstance) trendChartInstance.destroy();
                
                const gradientRev = ctxTrend.getContext('2d').createLinearGradient(0, 0, 0, 300);
                gradientRev.addColorStop(0, 'rgba(14, 165, 233, 0.4)');
                gradientRev.addColorStop(1, 'rgba(14, 165, 233, 0.0)');
                
                const gradientProf = ctxTrend.getContext('2d').createLinearGradient(0, 0, 0, 300);
                gradientProf.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
                gradientProf.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

                trendChartInstance = new Chart(ctxTrend, {
                    type: 'line',
                    data: {
                        labels: labels.length ? labels : ['No Data'],
                        datasets: [
                            {
                                label: 'Revenue (₹)',
                                data: salesData.length ? salesData : [0],
                                borderColor: '#0ea5e9',
                                backgroundColor: gradientRev,
                                borderWidth: 3,
                                fill: true,
                                tension: 0.4,
                                pointBackgroundColor: '#ffffff',
                                pointBorderColor: '#0ea5e9',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                pointHoverRadius: 6
                            },
                            {
                                label: 'Est. Net Profit (₹)',
                                data: profitData.length ? profitData : [0],
                                borderColor: '#10b981',
                                backgroundColor: gradientProf,
                                borderWidth: 3,
                                fill: true,
                                tension: 0.4,
                                pointBackgroundColor: '#ffffff',
                                pointBorderColor: '#10b981',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                pointHoverRadius: 6
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: { 
                            legend: { 
                                position: 'top',
                                labels: { usePointStyle: true, padding: 20, font: { family: "'Inter', sans-serif", size: 12, weight: '500' } }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                titleFont: { family: "'Inter', sans-serif", size: 13 },
                                bodyFont: { family: "'Inter', sans-serif", size: 13 },
                                padding: 12, cornerRadius: 8, displayColors: true
                            }
                        },
                        scales: { 
                            x: { grid: { display: false, drawBorder: false }, ticks: { font: { family: "'Inter', sans-serif", size: 11 }, color: '#64748b' } },
                            y: { beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false, borderDash: [5, 5] }, ticks: { font: { family: "'Inter', sans-serif", size: 11 }, color: '#64748b', callback: function(value) { return '₹' + value; } } }
                        }
                    }
                });
            }'''

content = content.replace(old_chart, new_chart)

with open('report.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replacement done.")
