#!/bin/bash
# 每座水門一支：三種雨量並排
set -e
F=/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc
mkdir -p out
declare -A NAME=([none]="全部水門關閉（對照組）" [huajiang]="華江門未關" [huazhong]="華中門未關" [machangding]="馬場町門未關" [guting]="古亭門未關" [jingfu]="景福門未關")
for g in none huajiang huazhong machangding guting jingfu; do
  title="${NAME[$g]}｜新店溪洪峰 6,750 m³/s・滿潮 EL. 1.6 m｜左→右：時雨量 40／80／120 mm"
  ffmpeg -y -loglevel error -framerate 7 -i frames/${g}_r40/f%03d.png -framerate 7 -i frames/${g}_r80/f%03d.png -framerate 7 -i frames/${g}_r120/f%03d.png \
    -filter_complex "[0]scale=640:400[a];[1]scale=640:400[b];[2]scale=640:400[c];[a][b][c]hstack=3,pad=1920:470:0:70:white,drawtext=fontfile=$F:text='$title':x=24:y=22:fontsize=28:fontcolor=0x111111,tpad=stop_mode=clone:stop_duration=2,format=yuv420p" \
    -c:v libx264 -crf 22 -preset medium -movflags +faststart out/${g}.mp4
  echo "made $g"
done
# 合輯
printf "file '%s'\n" out/none.mp4 out/huajiang.mp4 out/huazhong.mp4 out/machangding.mp4 out/guting.mp4 out/jingfu.mp4 > out/list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i out/list.txt -c copy out/all_gates.mp4
echo "made all"
