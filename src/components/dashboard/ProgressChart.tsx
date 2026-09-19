"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export interface ProgressPoint {
  date: string;
  overall: number;
}

export function ProgressChart({ data }: { data: ProgressPoint[] }) {
  const chartData = data.map((d, i) => ({
    name: `#${i + 1}`,
    date: new Date(d.date).toLocaleDateString(),
    overall: d.overall,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#9ca3af" />
          <YAxis domain={[0, 9]} tickCount={10} tick={{ fontSize: 12 }} stroke="#9ca3af" />
          <Tooltip
            formatter={(value) => [Number(value).toFixed(1), "Overall"]}
            labelFormatter={(label, payload) =>
              payload?.[0]?.payload?.date ? `${label} — ${payload[0].payload.date}` : label
            }
          />
          <Line
            type="monotone"
            dataKey="overall"
            stroke="#2544eb"
            strokeWidth={2}
            dot={{ r: 4, fill: "#2544eb" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
