package main

import (
    "encoding/json"
    "io"
    "log"
    "net/http"
    "os"
    "strings"
    "time"
    "path/filepath"
    amaasclient "github.com/trendmicro/tm-v1-fs-golang-sdk"
)

// ScanResponse represents the response we'll send back to the Node.js application
type ScanResponse struct {
    IsSafe     bool     `json:"isSafe"`
    Message    string   `json:"message"`
    ScanID     string   `json:"scanId,omitempty"`
    Detections string   `json:"detections,omitempty"`
    Tags       []string `json:"tags,omitempty"`
}

// HealthResponse represents the health check response
type HealthResponse struct {
    Status      string    `json:"status"`
    Timestamp   string    `json:"timestamp"`
    CustomTags  []string  `json:"customTags"`
    APIEndpoint string    `json:"apiEndpoint"`
}

// Get environment variable with default value
func getEnv(key, defaultValue string) string {
    value := os.Getenv(key)
    if value == "" {
        return defaultValue
    }
    return value
}

// Get custom tags from environment
func getCustomTags() []string {
    customTags := os.Getenv("FSS_CUSTOM_TAGS")
    if customTags == "" {
        return []string{}
    }
    return strings.Split(customTags, ",")
}

func main() {
    // Get configuration from environment variables
    apiKey := os.Getenv("FSS_API_KEY")
    region := getEnv("FSS_REGION", "us-1")

    // Validate required environment variables
    if apiKey == "" {
        log.Fatal("FSS_API_KEY environment variable must be set")
    }

    // Get custom tags
    customTags := getCustomTags()

    // Configure logging
    f, err := os.OpenFile("/app/scanner.log", os.O_RDWR|os.O_CREATE|os.O_APPEND, 0666)
    if err != nil {
        log.Fatalf("Error opening log file: %v", err)
    }
    defer f.Close()
    log.SetOutput(f)

    // Log startup configuration
    log.Printf("Scanner Service Starting")
    log.Printf("Configuration:")
    log.Printf("- Region: %s", region)
    log.Printf("- Custom Tags: %v", customTags)

    // Create AMaaS client
    client, err := amaasclient.NewClient(apiKey, region)
    if err != nil {
        log.Fatalf("Failed to create AMaaS client: %v", err)
    }

    // Disable digest calculation to reduce network traffic
    client.SetDigestDisable()

    // Handle scan requests
    http.HandleFunc("/scan", func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
            http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
            return
        }

        // Read file data
        data, err := io.ReadAll(r.Body)
        if err != nil {
            log.Printf("Error reading request body: %v", err)
            http.Error(w, "Failed to read request body", http.StatusBadRequest)
            return
        }

        // Get filename from header if provided
        filename := r.Header.Get("X-Filename")
        if filename == "" {
            filename = "unknown"
        }

        // Generate unique identifier
        identifier := time.Now().Format("20060102150405") + "-" + filepath.Base(filename)

        // Combine default and custom tags
        tags := append([]string{
            "bytevault",                    // Application tag
            "upload",                       // Operation tag
            filepath.Ext(filename),         // File extension tag
            time.Now().Format("2006-01-02"), // Date tag
        }, customTags...)

        // Scan the buffer
        log.Printf("Starting scan for file: %s with tags: %v", identifier, tags)
        scanResult, err := client.ScanBuffer(data, identifier, tags)
        if err != nil {
            log.Printf("Scan error for %s: %v", identifier, err)
            http.Error(w, "Scanning failed", http.StatusInternalServerError)
            return
        }

        // Prepare response based on scan result
        response := ScanResponse{
            IsSafe:     scanResult == "clean",
            Message:    scanResult,
            ScanID:     identifier,
            Tags:       tags,
            Detections: scanResult,
        }

        // Send response
        w.Header().Set("Content-Type", "application/json")
        if err := json.NewEncoder(w).Encode(response); err != nil {
            log.Printf("Error encoding response: %v", err)
            http.Error(w, "Error encoding response", http.StatusInternalServerError)
            return
        }
        
        log.Printf("Scan completed for %s: %s with tags: %v", identifier, scanResult, tags)
    })

    // Health check endpoint
    http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        response := HealthResponse{
            Status:      "healthy",
            Timestamp:   time.Now().Format(time.RFC3339),
            CustomTags:  customTags,
            APIEndpoint: region,
        }

        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(response)
    })

    // Start the server
    log.Printf("Scanner service starting on :3001")
    if err := http.ListenAndServe(":3001", nil); err != nil {
        log.Fatalf("Server failed: %v", err)
    }
}
