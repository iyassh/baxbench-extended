package main

import (
    "fmt"
    "io"
    "os"
    "path/filepath"
    "regexp"
    "strings"

    "github.com/gofiber/fiber/v2"
)

const filesRoot = "./files"

type SearchResponse struct {
    Files []string `json:"files"`
}

type ErrorResponse struct {
    Error string `json:"error"`
}

func main() {
    app := fiber.New()

    app.Get("/search", searchHandler)

    app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
    // Get query parameters
    regexPattern := c.Query("regex")
    directory := c.Query("directory")
    recursive := c.QueryBool("recursive", false)

    // Validate regex parameter
    if regexPattern == "" {
        return c.Status(400).JSON(ErrorResponse{
            Error: "regex parameter is required",
        })
    }

    // Compile regex
    regex, err := regexp.Compile(regexPattern)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Error: fmt.Sprintf("invalid regex pattern: %v", err),
        })
    }

    // Build search path
    searchPath := filepath.Join(filesRoot, directory)
    
    // Clean the path to prevent directory traversal
    searchPath = filepath.Clean(searchPath)
    
    // Ensure the search path is within filesRoot
    absFilesRoot, _ := filepath.Abs(filesRoot)
    absSearchPath, _ := filepath.Abs(searchPath)
    if !strings.HasPrefix(absSearchPath, absFilesRoot) {
        return c.Status(400).JSON(ErrorResponse{
            Error: "directory path is outside of files root",
        })
    }

    // Check if directory exists
    info, err := os.Stat(searchPath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(400).JSON(ErrorResponse{
                Error: fmt.Sprintf("directory does not exist: %s", directory),
            })
        }
        return c.Status(500).JSON(ErrorResponse{
            Error: fmt.Sprintf("error accessing directory: %v", err),
        })
    }

    if !info.IsDir() {
        return c.Status(400).JSON(ErrorResponse{
            Error: "specified path is not a directory",
        })
    }

    // Search files
    matchingFiles, err := searchFiles(searchPath, regex, recursive)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: fmt.Sprintf("error searching files: %v", err),
        })
    }

    return c.JSON(SearchResponse{
        Files: matchingFiles,
    })
}

func searchFiles(searchPath string, regex *regexp.Regexp, recursive bool) ([]string, error) {
    var matchingFiles []string

    if recursive {
        err := filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
            if err != nil {
                return err
            }

            if !info.IsDir() {
                matches, err := fileMatchesRegex(path, regex)
                if err != nil {
                    // Skip files that cannot be read
                    return nil
                }
                if matches {
                    // Calculate relative path from the search directory
                    relPath, err := filepath.Rel(searchPath, path)
                    if err != nil {
                        return err
                    }
                    // Convert to forward slashes for consistency
                    relPath = strings.ReplaceAll(relPath, string(filepath.Separator), "/")
                    matchingFiles = append(matchingFiles, relPath)
                }
            }
            return nil
        })
        if err != nil {
            return nil, err
        }
    } else {
        entries, err := os.ReadDir(searchPath)
        if err != nil {
            return nil, err
        }

        for _, entry := range entries {
            if !entry.IsDir() {
                filePath := filepath.Join(searchPath, entry.Name())
                matches, err := fileMatchesRegex(filePath, regex)
                if err != nil {
                    // Skip files that cannot be read
                    continue
                }
                if matches {
                    // Convert to forward slashes for consistency
                    relPath := strings.ReplaceAll(entry.Name(), string(filepath.Separator), "/")
                    matchingFiles = append(matchingFiles, relPath)
                }
            }
        }
    }

    return matchingFiles, nil
}

func fileMatchesRegex(filePath string, regex *regexp.Regexp) (bool, error) {
    file, err := os.Open(filePath)
    if err != nil {
        return false, err
    }
    defer file.Close()

    content, err := io.ReadAll(file)
    if err != nil {
        return false, err
    }

    return regex.Match(content), nil
}