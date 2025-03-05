# HackedVault - Secure File Storage with Malware Scanning

HackedVault is a containerized file storage application with malware scanning capabilities, web interface, and REST API. It provides secure file upload, scanning, and management.

## Features
- Web interface for file management
- Real-time malware scanning using File Security Services
- Configurable security modes (Prevent/Log Only/Disabled)
- File upload with automated scanning
- Scan history and status monitoring
- Health monitoring dashboard
- RESTful API with Basic Authentication
- Session-based web authentication
- Docker containerization
- Optional admin configuration
- Role-based access control

## Directory Structure
```
hackedvault/
├── Dockerfile              # Container configuration
├── scanner.go             # Go-based scanner service
├── server.js              # Express server implementation
├── package.json           # Node.js dependencies
├── middleware/            # Application middleware
│   └── auth.js           # Authentication middleware
└── public/                # Static files directory
    ├── components/       # UI components
    ├── index.html        # Welcome page
    ├── login.html        # Login interface
    ├── dashboard.html    # File management interface
    ├── scan-results.html # Scan history interface
    ├── health-status.html # System health monitoring
    ├── configuration.html # System configuration page
    ├── styles.css        # Application styling
    └── script.js         # Client-side functionality
```

## Quick Start

1. Set up File Security Services:
```bash
export FSS_API_KEY=your_api_key
```

2. Build and run:
```bash
docker build -t hackedvault:latest .

# Run with only user account (no admin)
docker run -d \
  -p 3000:3000 -p 3001:3001 \
  -e FSS_API_ENDPOINT="antimalware.us-1.cloudone.trendmicro.com:443" \
  -e FSS_API_KEY=$FSS_API_KEY \
  -e USER_USERNAME="user" \
  -e USER_PASSWORD="your_password" \
  -e FSS_CUSTOM_TAGS="env:hackedvault,team:security" \
  -e SECURITY_MODE="prevent" \
  --name hackedvault \
  hackedvault:latest

# Or run with both user and admin accounts
docker run -d \
  -p 3000:3000 -p 3001:3001 \
  -e FSS_API_ENDPOINT="antimalware.us-1.cloudone.trendmicro.com:443" \
  -e FSS_API_KEY=$FSS_API_KEY \
  -e USER_USERNAME="user" \
  -e USER_PASSWORD="your_password" \
  -e ADMIN_USERNAME="admin" \
  -e ADMIN_PASSWORD="admin_password" \
  -e FSS_CUSTOM_TAGS="env:hackedvault,team:security" \
  -e SECURITY_MODE="prevent" \
  --name hackedvault \
  hackedvault:latest
```

3. Access the application:
- Web Interface: http://localhost:3000
- API Endpoints: http://localhost:3000/api/* (with Basic Auth)

## Security Modes

HackedVault supports three security modes:

### Disabled Mode (Default)
- Bypasses malware scanning
- Files are uploaded directly without scanning
- Maintains logging of uploads with clear "Not Scanned" status
- Suitable for trusted environments or testing
- Can be enabled/disabled by administrators only (when admin account is configured)

### Prevent Mode
- Blocks and deletes malicious files immediately
- Notifies users when malware is detected
- Provides highest security level
- Files marked as malicious are not stored

### Log Only Mode
- Allows all file uploads
- Logs and marks malicious files
- Warns users about detected threats
- Useful for testing and monitoring

## Authentication

HackedVault supports two authentication methods:

### Web Interface Authentication
- Session-based authentication
- Login through web interface at `/login`
- Configurable user credentials via environment variables
- Optional admin account for configuration management

### API Authentication
- Basic Authentication for all API endpoints
- Supports both user and admin credentials
- Works with standard API tools and curl commands
- Same credentials as web interface

### Default Credentials
- User Account (Required):
  - Configured via USER_USERNAME and USER_PASSWORD
  - Can upload and manage files
  - Cannot modify system configuration
- Admin Account (Optional):
  - Configured via ADMIN_USERNAME and ADMIN_PASSWORD
  - Full access to all features
  - Can modify system configuration
  - If not configured, configuration changes are disabled

## API Reference

### Endpoints

#### Upload File
```bash
# Upload with user account
curl -X POST http://localhost:3000/upload \
  -u "user:your_password" \
  -F "file=@/path/to/your/file.txt"

# Upload with admin account (if configured)
curl -X POST http://localhost:3000/upload \
  -u "admin:admin_password" \
  -F "file=@/path/to/your/file.txt"

# Example Response (Safe File)
{
    "message": "File uploaded and scanned successfully",
    "results": [{
        "file": "example.txt",
        "status": "success",
        "message": "File uploaded and scanned successfully",
        "scanResult": {
            "isSafe": true
        }
    }]
}

# Example Response (Disabled Mode)
{
    "message": "File upload processing complete",
    "results": [{
        "file": "example.txt",
        "status": "success",
        "message": "File uploaded successfully (scanning disabled)",
        "scanResult": {
            "isSafe": null,
            "message": "Scanning disabled"
        }
    }]
}
```

#### Get Configuration
```bash
# Access with user account (view only)
curl http://localhost:3000/api/config -u "user:your_password"

# Access with admin account (if configured)
curl http://localhost:3000/api/config -u "admin:admin_password"
```

#### Update Configuration (Admin Only)
```bash
# Only works if admin account is configured
curl -X POST http://localhost:3000/api/config \
  -u "admin:admin_password" \
  -H "Content-Type: application/json" \
  -d '{"securityMode": "prevent"}'
```

#### List Files
```bash
curl http://localhost:3000/files -u "user:your_password"
```

#### Get Scan Results
```bash
curl http://localhost:3000/api/scan-results -u "user:your_password"
```

#### Get System Health
```bash
curl http://localhost:3000/health -u "user:your_password"
```

#### Delete File
```bash
curl -X DELETE http://localhost:3000/files/filename.txt -u "user:your_password"
```

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| FSS_API_KEY | File Security Services API Key | Required | Yes |
| FSS_API_ENDPOINT | FSS API Endpoint | antimalware.us-1.cloudone.trendmicro.com:443 | No |
| FSS_CUSTOM_TAGS | Custom tags for scans | env:hackedvault,team:security | No |
| USER_USERNAME | Regular user username | user | No |
| USER_PASSWORD | Regular user password | user123 | No |
| ADMIN_USERNAME | Admin username | Not configured | No |
| ADMIN_PASSWORD | Admin password | Not configured | No |
| SECURITY_MODE | Default security mode (prevent/logOnly/disabled) | disabled | No |

## Web Interface

### Dashboard
- File upload with real-time scanning
- File listing and management
- Delete functionality
- Clear scan status indicators
- Supports drag-and-drop file upload

### Scan Results
- View scan history
- Filter by safe/unsafe/unscanned files
- Detailed scan information
- Clear status badges for each scan state
- Real-time updates

### Health Status
- System health monitoring
- Scanner status
- Scan statistics by category
- Security mode status
- System uptime tracking

### Configuration
- Security mode management
- System settings
- Real-time updates
- Role-based access control
- Disabled when admin account is not configured

## Volumes and Persistence

Mount volumes for persistent storage:
```bash
docker run -d \
  -p 3000:3000 -p 3001:3001 \
  -v /path/on/host:/app/uploads \
  -e FSS_API_KEY=$FSS_API_KEY \
  -e USER_USERNAME="user" \
  -e USER_PASSWORD="your_password" \
  -e SECURITY_MODE="prevent" \
  --name hackedvault \
  hackedvault:latest
```

## Troubleshooting

### Common Issues

#### Authentication Issues
- Verify correct credentials are being used
- Check if credentials contain special characters
- Ensure proper Basic Auth encoding for API calls
- Verify admin account is configured if attempting admin operations

#### Scanner Issues
- Verify FSS_API_KEY is set correctly
- Check scanner logs: `docker logs hackedvault | grep scanner`
- Verify both ports (3000 and 3001) are accessible
- Check if security mode is not disabled

#### Configuration Issues
- Verify admin account is configured if trying to change settings
- Check if user has appropriate permissions
- Verify security mode settings

#### Upload Issues
- Check file permissions
- Verify scanner status
- Check upload size limits
- Verify correct credentials for API uploads

View logs:
```bash
docker logs hackedvault
docker logs -f hackedvault
```
