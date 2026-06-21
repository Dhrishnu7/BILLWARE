using System;
using System.IO;
using System.Text;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        string[] files = Directory.GetFiles(".", "*.html", SearchOption.AllDirectories);
        Encoding cp1252 = Encoding.GetEncoding(1252);
        Encoding utf8 = new UTF8Encoding(false); // No BOM
        
        // Let's create a known dictionary of replacements to avoid corrupting everything.
        // Or actually, doing an automated pass on substrings that match UTF-8 multi-byte sequences parsed as CP-1252.
        
        Dictionary<string, string> replacements = new Dictionary<string, string>();
        
        string[] targetSymbols = new string[] {
            "──", "👥", "…", "—", "✓", "🔑", "👋", "💵", "📈", "📦", "🛒", "📄", "🔍", "➕", "🗑", "🚚", "👨‍⚕️", "💊", "₹", "“", "”"
        };
        
        foreach (string sym in targetSymbols) {
            byte[] symBytes = utf8.GetBytes(sym);
            string mojibake = cp1252.GetString(symBytes);
            replacements[mojibake] = sym;
            Console.WriteLine("Map: " + mojibake + " -> " + sym);
        }

        foreach (string file in files) {
            string content = File.ReadAllText(file, utf8);
            bool changed = false;
            foreach (var kvp in replacements) {
                if (content.Contains(kvp.Key)) {
                    content = content.Replace(kvp.Key, kvp.Value);
                    changed = true;
                }
            }
            if (changed) {
                File.WriteAllText(file, content, utf8);
                Console.WriteLine("Fixed file: " + file);
            }
        }
    }
}
