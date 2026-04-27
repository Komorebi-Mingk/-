import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { TrendReport } from "../types";

type Props = {
  data: TrendReport[];
};

export function TrendChart({ data }: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }
    const chart = echarts.init(chartRef.current);
    chart.setOption({
      tooltip: { trigger: "axis" },
      grid: { left: 20, right: 20, top: 30, bottom: 30, containLabel: true },
      xAxis: {
        type: "category",
        data: data.map((item) => item.reportDate)
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100
      },
      series: [
        {
          name: "康复评分",
          type: "line",
          smooth: true,
          data: data.map((item) => item.score),
          areaStyle: {
            opacity: 0.15
          }
        }
      ]
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [data]);

  return <div className="chart" ref={chartRef} />;
}
