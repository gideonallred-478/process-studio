param([string]$Directory, [switch]$Inventory, [switch]$CompileOnly, [switch]$ContractTest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
$source = @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Web.Script.Serialization;
public class StudioCamera : Form {
 [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr h,uint affinity);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref POINT p);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,System.Text.StringBuilder text,int size);
 delegate bool EnumProc(IntPtr h,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr param);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 struct RECT {public int Left,Top,Right,Bottom;}
 struct POINT {public int X,Y;}
 readonly string directory; readonly JavaScriptSerializer json=new JavaScriptSerializer();
 readonly Timer timer=new Timer(); Image frame; bool dragging; Point dragAt; long dragRevision; string lastAnchor=""; bool safe; Rectangle capture;
 public static void Dpi(){try{if(SetProcessDpiAwarenessContext(new IntPtr(-4)))return;}catch(EntryPointNotFoundException){}SetProcessDPIAware();}
 public static bool AllowAutoPlacement(bool dragging,long dragRevision,long acknowledgedDragRevision){return !dragging && acknowledgedDragRevision>=dragRevision;}
 static object SurfaceBounds(Rectangle r){return new {left=r.Left,top=r.Top,width=r.Width,height=r.Height};}
 static Rectangle WindowBounds(IntPtr h){RECT r;POINT p=new POINT();if(!IsWindowVisible(h)||IsIconic(h)||!GetClientRect(h,out r)||!ClientToScreen(h,ref p))return Rectangle.Empty;return new Rectangle(p.X,p.Y,r.Right-r.Left,r.Bottom-r.Top);}
 public static string Inventory(){var surfaces=new List<object>();foreach(Screen s in Screen.AllScreens)surfaces.Add(new {id="monitor:"+s.DeviceName,kind="monitor",label=s.DeviceName+(s.Primary?" (primary)":""),bounds=SurfaceBounds(s.Bounds)});EnumWindows(delegate(IntPtr h,IntPtr p){var title=new System.Text.StringBuilder(512);GetWindowText(h,title,title.Capacity);Rectangle r=WindowBounds(h);if(title.Length>0&&r.Width>100&&r.Height>100)surfaces.Add(new {id="window:"+h.ToInt64(),kind="window",label=title.ToString(),bounds=SurfaceBounds(r)});return true;},IntPtr.Zero);return new JavaScriptSerializer().Serialize(new {surfaces=surfaces});}
 Rectangle Surface(string id){if(id.StartsWith("monitor:")){foreach(Screen s in Screen.AllScreens)if("monitor:"+s.DeviceName==id)return s.Bounds;}else if(id.StartsWith("window:")){long h;if(long.TryParse(id.Substring(7),out h))return WindowBounds(new IntPtr(h));}return Rectangle.Empty;}
 public StudioCamera(string folder){directory=folder;FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;BackColor=Color.Magenta;TransparencyKey=Color.Magenta;DoubleBuffered=true;Size=new Size(194,194);Opacity=0;timer.Interval=100;timer.Tick+=delegate{TickFrame();};timer.Start();MouseDown+=delegate(object o,MouseEventArgs e){if(e.Button==MouseButtons.Left){dragging=true;dragAt=e.Location;Capture=true;}};MouseMove+=delegate(object o,MouseEventArgs e){if(dragging){Left+=e.X-dragAt.X;Top+=e.Y-dragAt.Y;}};MouseUp+=delegate{if(dragging){dragging=false;Capture=false;dragRevision++;WriteStatus();}};Shown+=delegate{safe=SetWindowDisplayAffinity(Handle,0x11);if(!safe){Fail("Windows could not exclude the camera overlay from screen capture.");}};FormClosed+=delegate{timer.Stop();if(frame!=null)frame.Dispose();};}
 void Fail(string error){try{File.WriteAllText(Path.Combine(directory,"status.json"),json.Serialize(new {error=error}));}catch{}Close();}
 void WriteStatus(){if(capture.Width<=0||capture.Height<=0)return;File.WriteAllText(Path.Combine(directory,"status.json"),json.Serialize(new {ready=safe,excluded=safe,dragRevision=dragRevision,anchor=new {x=Math.Max(0,Math.Min(1,(Left+Width/2.0-capture.Left)/capture.Width)),y=Math.Max(0,Math.Min(1,(Top+Height/2.0-capture.Top)/capture.Height))},bounds=SurfaceBounds(capture)}));}
 void TickFrame(){if(!Directory.Exists(directory)){Close();return;}try{string stateFile=Path.Combine(directory,"state.json");DateTime write=File.GetLastWriteTimeUtc(stateFile);if(DateTime.UtcNow-write>TimeSpan.FromSeconds(12)){Close();return;}var data=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(stateFile));capture=Surface((string)data["captureId"]);if(capture.IsEmpty){Fail("The captured window is closed or minimized. Use the recording preview.");return;}var anchor=(Dictionary<string,object>)data["anchor"];double x=Convert.ToDouble(anchor["x"]),y=Convert.ToDouble(anchor["y"]),radius=Convert.ToDouble(data["radius"]);int diameter=Math.Max(48,(int)Math.Round(Math.Min(capture.Width,capture.Height)*radius*2));string key=x+","+y+","+diameter+","+capture.ToString();long acknowledged=data.ContainsKey("acknowledgedDragRevision")?Convert.ToInt64(data["acknowledgedDragRevision"]):0;if(AllowAutoPlacement(dragging,dragRevision,acknowledged)&&key!=lastAnchor){Size=new Size(diameter,diameter);Location=new Point(capture.Left+(int)Math.Round(x*capture.Width)-diameter/2,capture.Top+(int)Math.Round(y*capture.Height)-diameter/2);lastAnchor=key;}string frameFile=Path.Combine(directory,"frame.jpg");if(safe&&File.Exists(frameFile)){byte[] bytes=File.ReadAllBytes(frameFile);using(var stream=new MemoryStream(bytes))using(var decoded=Image.FromStream(stream)){Image next=new Bitmap(decoded);if(frame!=null)frame.Dispose();frame=next;}Opacity=1;Invalidate();}WriteStatus();}catch(IOException){}catch(ArgumentException){}catch(Exception e){Fail(e.Message);}}
 protected override void OnPaint(PaintEventArgs e){e.Graphics.Clear(BackColor);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;using(var clip=new GraphicsPath()){clip.AddEllipse(2,2,Width-4,Height-4);e.Graphics.SetClip(clip);if(frame!=null)e.Graphics.DrawImage(frame,new Rectangle(0,0,Width,Height));else e.Graphics.FillEllipse(Brushes.DarkSlateGray,0,0,Width,Height);e.Graphics.ResetClip();}using(var pen=new Pen(Color.White,4))e.Graphics.DrawEllipse(pen,2,2,Width-4,Height-4);}
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
[StudioCamera]::Dpi()
if ($CompileOnly) { 'Desktop camera helper compiled'; exit }
if ($ContractTest) {
  if ([StudioCamera]::AllowAutoPlacement($false, 2, 1)) { throw 'Unacknowledged drag moved' }
  if ([StudioCamera]::AllowAutoPlacement($true, 2, 2)) { throw 'Active drag moved' }
  if (-not [StudioCamera]::AllowAutoPlacement($false, 2, 2)) { throw 'Acknowledged placement blocked' }
  if (-not [StudioCamera]::AllowAutoPlacement($false, 0, 0)) { throw 'Initial placement blocked' }
  'Drag acknowledgement contract passed'; exit
}
if ([int](Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber -lt 19041) { throw 'Desktop camera capture exclusion requires Windows 10 version 2004 or later' }
if ($Inventory) { [StudioCamera]::Inventory(); exit }
if (-not $Directory -or -not (Test-Path -LiteralPath $Directory)) { throw 'Camera session folder missing' }
[System.Windows.Forms.Application]::Run([StudioCamera]::new($Directory))


