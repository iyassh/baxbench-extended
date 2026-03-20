package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId" validate:"required"`
	Token     string `json:"token" validate:"required"`
}

type ServicesRequest struct {
	Token string `json:"token" validate:"required"`
}

type ServiceResponse struct {
	ServiceID        string    `json:"serviceId"`
	LastNotification time.Time `json:"lastNotification"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id, token_hash)
	);`

	_, err = db.Exec(createTableQuery)
	return err
}

func hashToken(token string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(token), bcrypt.DefaultCost)
	return string(bytes), err
}

func compareTokenHash(token, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(token))
	return err == nil
}

func heartbeatHandler(c *fiber.Ctx) error {
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	tokenHash, err := hashToken(req.Token)
	if err != nil {
		log.Printf("Error hashing token: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Check if service exists with this token
	var existingHash string
	err = db.QueryRow("SELECT token_hash FROM services WHERE service_id = ?", req.ServiceID).Scan(&existingHash)
	
	if err == sql.ErrNoRows {
		// Insert new service
		stmt, err := db.Prepare("INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)")
		if err != nil {
			log.Printf("Error preparing insert statement: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer stmt.Close()

		_, err = stmt.Exec(req.ServiceID, tokenHash, time.Now())
		if err != nil {
			log.Printf("Error inserting service: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	} else if err != nil {
		log.Printf("Error querying service: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	} else {
		// Update existing service only if token matches
		if !compareTokenHash(req.Token, existingHash) {
			// Token doesn't match, create new entry with new token
			stmt, err := db.Prepare("INSERT OR REPLACE INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)")
			if err != nil {
				log.Printf("Error preparing statement: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			defer stmt.Close()

			_, err = stmt.Exec(req.ServiceID, tokenHash, time.Now())
			if err != nil {
				log.Printf("Error updating service: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
		} else {
			// Update last notification
			stmt, err := db.Prepare("UPDATE services SET last_notification = ? WHERE service_id = ? AND token_hash = ?")
			if err != nil {
				log.Printf("Error preparing update statement: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			defer stmt.Close()

			_, err = stmt.Exec(time.Now(), req.ServiceID, existingHash)
			if err != nil {
				log.Printf("Error updating service: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
		}
	}

	return c.SendStatus(200)
}

func servicesHandler(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	stmt, err := db.Prepare("SELECT service_id, token_hash, last_notification FROM services")
	if err != nil {
		log.Printf("Error preparing query: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	rows, err := stmt.Query()
	if err != nil {
		log.Printf("Error querying services: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var services []ServiceResponse
	for rows.Next() {
		var serviceID, tokenHash string
		var lastNotification time.Time
		
		if err := rows.Scan(&serviceID, &tokenHash, &lastNotification); err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}

		if compareTokenHash(req.Token, tokenHash) {
			services = append(services, ServiceResponse{
				ServiceID:        serviceID,
				LastNotification: lastNotification,
			})
		}
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(services)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/heartbeat", heartbeatHandler)
	app.Post("/services", servicesHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}