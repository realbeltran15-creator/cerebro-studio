# Cerebro Studio - diagnostico de requisitos en Windows. SOLO LEE informacion: no instala nada, no cambia configuracion, no abre red.
# Estado: ejecutado una vez en el PC de Jesus (ver docs/informe-p5-18-windows-beta.md). Uso: powershell -ExecutionPolicy Bypass -File diagnostico.ps1
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$ramFree = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$sys = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -PSProvider FileSystem
$freeGb = [math]::Round($sys.Free / 1GB, 1)
function Tool($n) { $c = Get-Command $n -ErrorAction SilentlyContinue; if ($c) { 'SI  (' + $c.Source + ')' } else { 'NO' } }
$virt = $cpu.VirtualizationFirmwareEnabled
$hv = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
$feat = @(Get-CimInstance Win32_OptionalFeature | Where-Object { $_.Name -match 'VirtualMachinePlatform|Microsoft-Windows-Subsystem-Linux|Microsoft-Hyper-V$' } | ForEach-Object { $_.Name + '=' + $_.InstallState })
Write-Output ('Sistema: ' + $os.Caption + ' ' + $os.Version + ' (' + $os.OSArchitecture + ')')
Write-Output ('Procesador: ' + $cpu.Name + ' | nucleos ' + $cpu.NumberOfCores + ' | hilos ' + $cpu.NumberOfLogicalProcessors)
Write-Output ('Virtualizacion habilitada en firmware: ' + $virt + ' | hipervisor activo: ' + $hv)
Write-Output ('RAM total: ' + $ramTotal + ' GB | libre ahora: ' + $ramFree + ' GB')
Write-Output ('Disco del sistema (' + $env:SystemDrive + ') libre: ' + $freeGb + ' GB')
Write-Output ('Caracteristicas WSL/VM: ' + ($feat -join ', '))
foreach ($t in 'node', 'npm', 'git', 'docker', 'wsl', 'supabase', 'ffmpeg', 'psql') { Write-Output ($t + ': ' + (Tool $t)) }
$v = & node --version 2>$null; if ($v) { Write-Output ('Version de Node: ' + $v) }
Write-Output ''
$ok = @(); $no = @()
if ($ramTotal -ge 8) { $ok += 'RAM >= 8 GB' } else { $no += ('RAM ' + $ramTotal + ' GB (se recomiendan 8 GB para Docker + Supabase)') }
if ($ramFree -ge 3) { $ok += 'RAM libre >= 3 GB' } else { $no += ('RAM libre ahora ' + $ramFree + ' GB (cierra programas antes de arrancar)') }
if ($freeGb -ge 20) { $ok += 'Disco libre >= 20 GB' } else { $no += ('Disco libre ' + $freeGb + ' GB (hacen falta >= 20 GB)') }
if ($virt -or $hv) { $ok += 'Virtualizacion disponible' } else { $no += 'Virtualizacion no detectada (Docker/WSL2 no funcionaran)' }
if (Get-Command node -ErrorAction SilentlyContinue) { $ok += 'Node.js instalado' } else { $no += 'Node.js no instalado' }
if (Get-Command docker -ErrorAction SilentlyContinue) { $ok += 'Docker instalado' } else { $no += 'Docker no instalado (NO se instalara sin tu permiso)' }
Write-Output ('CUMPLE: ' + ($ok -join '; '))
Write-Output ('NO CUMPLE / FALTA: ' + ($no -join '; '))
