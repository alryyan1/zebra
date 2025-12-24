import { printDirect, getPrinters } from "printer";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Get printer name from environment variable or default to "zebra"
// Common ZD888 printer names: "zebra", "ZDesigner ZD888", "ZD888", "Zebra ZD888"
const PRINTER_NAME = process.env.PRINTER_NAME || "zebra";

// Function to find ZD888 printer if exact name doesn't match
const findZD888Printer = (callback) => {
  getPrinters(function(err, printers) {
    if (err || !printers) {
      return callback(null, PRINTER_NAME);
    }
    
    // Look for ZD888 in printer names (case insensitive)
    const zd888Printer = printers.find(p => 
      p.name.toLowerCase().includes('zd888') || 
      p.name.toLowerCase().includes('zebra') ||
      p.name.toLowerCase() === 'zebra'
    );
    
    if (zd888Printer) {
      console.log(`Found ZD888 printer: "${zd888Printer.name}"`);
      callback(null, zd888Printer.name);
    } else {
      console.log(`Using default printer name: "${PRINTER_NAME}"`);
      console.log('Available printers:', printers.map(p => p.name).join(', '));
      callback(null, PRINTER_NAME);
    }
  });
};

function splitText(text, maxLength) {
  const result = [];
  for (let i = 0; i < text.length; i += maxLength) {
    result.push(text.substring(i, i + maxLength));
  }
  return result;
}

// ZPL barcode command for Zebra ZD888
// ^BC = Code 128 barcode
// Parameters: height, print interpretation line (Y/N), print check digit (Y/N), mode (N/U/A/D)
const createZPLBarcode = (x, y, height, data, showText = "Y") => {
  // ^FO = Field Origin (x, y position)
  // ^BY = Barcode field default (module width, wide bar width ratio, height)
  // ^BC = Code 128 barcode
  // ^FD = Field Data (the barcode data)
  // ^FS = Field Separator (ends the field)
  return `^FO${x},${y}^BY2,3,${height}^BCN,${height},Y,N,N^FD${data}^FS`;
};

// ZPL text command for Zebra ZD888
// ^A0 = Font 0 (default scalable font), N = normal orientation
// Parameters: font, rotation, height, width
const createZPLText = (x, y, text, fontHeight = 30, fontWidth = 30, rotation = "N") => {
  // Escape special characters in text
  const escapedText = text.replace(/\\/g, "\\\\").replace(/\^/g, "\\^").replace(/~/g, "\\~");
  // ^FO = Field Origin
  // ^A0 = Font 0, N = normal
  // ^FD = Field Data
  // ^FS = Field Separator
  return `^FO${x},${y}^A0${rotation},${fontHeight},${fontWidth}^FD${escapedText}^FS`;
};

// ZPL box/line command
const createZPLBox = (x, y, width, height, lineThickness = 2) => {
  // ^FO = Field Origin
  // ^GB = Graphic Box (width, height, line thickness, line color, rounding)
  // ^FS = Field Separator
  return `^FO${x},${y}^GB${width},${height},${lineThickness},B,0^FS`;
};

const printLabel = (patientObj, printerNameOverride = null) => {
  const usePrinter = (printerName) => {
    console.log(`Attempting to print to printer: "${printerName}"`);
    
    // Handle different data structures - support both nested and flat structures
    const patient = patientObj.patient || patientObj;
    const fullname = patient.name || patientObj.name;
    const visitNo = patient.visit_number || patientObj.visit_number || patientObj.visit_id;
    const pid = patientObj.id || patientObj.patient_id || patient.id;

    // Check if lab_requests exists - try top level first, then nested under patient
    const labRequests = patientObj.lab_requests || patient.lab_requests || patientObj.labRequests || patient.labRequests || [];
    
    if (!Array.isArray(labRequests) || labRequests.length === 0) {
      console.error("No lab requests found for patient");
      console.error("Available keys in payload:", Object.keys(patientObj));
      console.error("Patient object keys:", patient ? Object.keys(patient) : "No patient object");
      return;
    }

    console.log(`Found ${labRequests.length} lab request(s)`);
    console.log('Lab requests structure:', JSON.stringify(labRequests[0], null, 2));
    
    // Group tests by container - filter out undefined containers
    const containers = labRequests
      .map(req => {
        const mainTest = req.main_test || req.mainTest;
        if (mainTest && mainTest.container) {
          return mainTest.container;
        }
        return null;
      })
      .filter(container => container !== null && container.id);

    // Remove duplicate containers by id
    const uniqueContainers = containers.filter((container, index, self) => 
      index === self.findIndex(c => c.id === container.id)
    );

    // Check if we have any valid containers
    if (uniqueContainers.length === 0) {
      console.error("No valid containers found in lab requests");
      console.error("Containers extracted:", containers);
      return;
    }

    console.log(`Found ${uniqueContainers.length} unique container(s):`, uniqueContainers.map(c => c.container_name || c.name || `Container ${c.id}`));

    uniqueContainers.forEach(container => {
      // Get tests for this container
      const testsAccordingToContainer = labRequests
        .filter(req => {
          const mainTest = req.main_test || req.mainTest;
          return mainTest && mainTest.container && mainTest.container.id === container.id;
        })
        .map(req => {
          const mainTest = req.main_test || req.mainTest;
          // Try different possible property names for test name
          return mainTest?.main_test_name || mainTest?.name || req.name || req.test_name || 'Unknown Test';
        });

    // Build the test string
    let tests = testsAccordingToContainer.join(" - ");
    
    console.log(`Container ${container.id} (${container.container_name || container.name || 'Unknown'}): ${testsAccordingToContainer.length} test(s)`);
    console.log(`Tests: ${tests}`);

    // Split tests into multiple lines (max 25 chars each line for better readability)
    const lines = splitText(tests, 25);
    
    // Build ZPL command for Zebra ZD888
    // ^XA = Start of label format
    // ^MM = Print mode (T = tear-off, C = cut, P = peel-off)
    // ^PW = Print width (in dots, 203 dpi = ~2.5 inches = 508 dots for 2.5")
    // ^LL = Label length (in dots)
    // ^LH = Label home position (x, y)
    // ^PR = Print speed (A = 2 ips, B = 3 ips, C = 4 ips, D = 6 ips, E = 8 ips, F = 10 ips)
    // ^MD = Media darkness (0-30, default 15)
    
    let zplCommand = `^XA`; // Start label format
    zplCommand += `^MMT`; // Tear-off mode
    zplCommand += `^PW508`; // Print width: 2.5 inches at 203 dpi (508 dots)
    zplCommand += `^LL312`; // Label length: ~1.5 inches (312 dots)
    zplCommand += `^LH0,0`; // Label home position
    zplCommand += `^PRC`; // Print speed: 4 inches per second
    zplCommand += `^MD15`; // Media darkness: 15 (medium)
    zplCommand += `^BY2`; // Barcode field default: module width 2
    
    // Print border/box around label
    zplCommand += createZPLBox(10, 5, 488, 302, 2);
    
    // Print visit number at top (larger font)
    zplCommand += createZPLText(20, 15, visitNo || "N/A", 40, 30, "N");
    
    // Print barcode (Code 128) - position: x=200, y=60, height=80
    // Using visit ID or patient ID for barcode
    const barcodeData = String(pid || visitNo || "0");
    zplCommand += createZPLBarcode(200, 60, 80, barcodeData, "Y");
    
    // Print test names below barcode
    let textY = 150; // Start position for test names
    lines.forEach((line, i) => {
      if (line.trim()) {
        zplCommand += createZPLText(20, textY + (i * 25), line.trim(), 25, 20, "N");
      }
    });
    
    // Print container name if available
    const containerName = container.container_name || container.name;
    if (containerName) {
      zplCommand += createZPLText(20, textY + (lines.length * 25) + 10, `Container: ${containerName}`, 20, 18, "N");
    }
    
    zplCommand += `^XZ`; // End label format
    
    // Log the ZPL command for debugging (first 500 chars)
    console.log(`ZPL Command (preview): ${zplCommand.substring(0, 500)}...`);

    // Send print job
    printDirect({
      data: zplCommand,
      printer: printerName,
      type: "RAW",
      success: function (jobID) {
        console.log(`✓ Printed label for container ${container.id} with job ID: ${jobID}`);
      },
      error: function (err) {
        console.error(`✗ Error printing to "${printerName}":`, err);
        // List available printers to help debug
        getPrinters(function(printerErr, printers) {
          if (!printerErr && printers) {
            console.log('Available printers:', printers.map(p => p.name).join(', '));
            console.log('Try setting PRINTER_NAME environment variable to one of the above names');
          }
        });
      },
    });
  });
  };
  
  // Use override if provided, otherwise auto-detect or use default
  if (printerNameOverride) {
    usePrinter(printerNameOverride);
  } else {
    // Auto-detect ZD888 printer
    findZD888Printer((err, detectedPrinterName) => {
      usePrinter(detectedPrinterName);
    });
  }
};

// Endpoint to list available printers
app.get("/printers", function (req, res) {
  getPrinters(function(err, printers) {
    if (err) {
      return res.status(500).json({ status: 'error', message: err.message, printers: [] });
    }
    res.json({ 
      status: 'success', 
      printers: printers.map(p => ({ name: p.name, status: p.status })),
      currentPrinter: PRINTER_NAME
    });
  });
});

app.post("/", function (req, res) {
  try {
    let data = req.body;
    console.log('Received data:', JSON.stringify(data, null, 2));

    if (!data) {
      return res.status(400).json({ status: 'error', message: 'No data received' });
    }

    // Allow printer name override via request body or query parameter
    const printerName = data.printer_name || req.query.printer_name || null;
    
    // Start printing (async)
    printLabel(data, printerName);
    
    // Return immediately (printing happens asynchronously)
    res.json({ 
      status: 'success', 
      message: 'Print job(s) sent to printer',
      printer: printerName || 'auto-detecting ZD888...',
      note: 'Printing is asynchronous. Check console logs for print status.'
    });
  } catch (error) {
    console.error('Error processing print request:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.listen(5000, () => {
  console.log("Example app listening at http://localhost:5000");
});

// ZPL Command Breakdown for Zebra ZD888:
// ^XA - Start of label format
// ^MMT - Print mode: Tear-off
// ^PW508 - Print width: 508 dots (2.5 inches at 203 dpi)
// ^LL312 - Label length: 312 dots (~1.5 inches)
// ^LH0,0 - Label home position (x=0, y=0)
// ^PRC - Print speed: 4 inches per second
// ^MD15 - Media darkness: 15 (medium darkness)
// ^BY2 - Barcode module width: 2 dots
// ^FO - Field Origin (sets x,y position)
// ^A0 - Font 0 (default scalable font)
// ^BC - Code 128 barcode
// ^FD - Field Data (the actual text/barcode data)
// ^FS - Field Separator (ends the field)
// ^GB - Graphic Box (draws a box/line)
// ^XZ - End of label format

// Printer Specifications for ZD888:
// - Resolution: 203 dpi (8 dots/mm)
// - Print width: Up to 2.5 inches (508 dots)
// - Print speed: Up to 4 ips
// - Supports ZPL programming language
// - Thermal transfer or direct thermal printing
