// Optional add on - serial link to the ESP board.
use std::io::Write;
use std::time::Duration;
use std::sync::mpsc::Receiver;

// Find the board's COM port
pub fn find_board() -> Option<String>
{
    let ports = serialport::available_ports().ok()?;
    for p in ports
    {
        if let serialport::SerialPortType::UsbPort(info) = p.port_type
        {
            if info.vid == 0x303A
            {
                return Some(p.port_name);
            }
        }
    }
    None
}

pub fn start(rx: Receiver<String>)
{
    std::thread::spawn(move ||
    {
        loop
        {
            // 1. Wait for a board to appear, draining stale state while we wait.
            let name = loop
            {
                if let Some(n) = find_board() { break n; }
                while rx.try_recv().is_ok() {}
                std::thread::sleep(Duration::from_secs(2));
            };

            // 2. Open it; on failure, wait and retry from the top.
            let mut port = match serialport::new(&name, 115200)
                .timeout(Duration::from_secs(2))
                .open()
            {
                Ok(p)  => { println!("[serial] connected {name}"); p }
                Err(e) =>
                {
                    println!("[serial] open failed: {e}");
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };
            while rx.try_recv().is_ok() {}

            // 3. Stream until a write fails (unplug) or the app shuts down.
            loop
            {
                match rx.recv()
                {
                    Ok(payload) =>
                    {
                        if let Some(frame) = to_np_frame(&payload)
                        {
                            if port.write_all(frame.as_bytes()).is_err()
                            {
                                println!("[serial] link lost, reconnecting");
                                break;
                            }
                        }
                    }
                    Err(_) => return,
                }
            }
        }
    });
}

fn to_np_frame(payload: &str) -> Option<String>
{
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let status = if v["playing"].as_bool().unwrap_or(false) { "playing" } else { "paused" };
    let frame = serde_json::json!(
    {
        "t":      "np",
        "title":  v["title"].as_str().unwrap_or(""),
        "artist": v["author"].as_str().unwrap_or(""),
        "status": status,                               
        "cur":    v["cur"].as_f64().unwrap_or(0.0) as i64,
        "dur":    v["dur"].as_f64().unwrap_or(0.0) as i64,
    });

    Some(format!("{frame}\n"))
}