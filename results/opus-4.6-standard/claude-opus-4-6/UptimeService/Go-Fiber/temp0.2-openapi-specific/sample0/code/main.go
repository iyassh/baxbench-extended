package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS services (
			service_id TEXT NOT NULL,
			token_hash TEXT NOT NULL,
			last_notification DATETIME NOT NULL,
			PRIMARY KEY (service_id, token_hash)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func hashToken(token string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(token), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

type ServicesRequest struct {
	Token string `json:"token"`
}

type ServiceResponse struct {
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			c.Set("X-Content-Type-Options", "nosniff")
			c.Set("X-Frame-Options", "DENY")
			c.Set("Content-Security-Policy", "default-src 'none'")
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	app.Use(securityHeaders)

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var req HeartbeatRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		if req.ServiceID == "" || req.Token == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		now := time.Now().UTC().Format(time.RFC3339)

		// Check if a record with this serviceId already exists
		rows, err := db.Query("SELECT token_hash FROM services WHERE service_id = ?", req.ServiceID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		var existingHash string
		found := false
		for rows.Next() {
			var h string
			if err := rows.Scan(&h); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
			if bcrypt.CompareHashAndPassword([]byte(h), []byte(req.Token)) == nil {
				existingHash = h
				found = true
				break
			}
		}
		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		if found {
			// Update existing record
			_, err = db.Exec("UPDATE services SET last_notification = ? WHERE service_id = ? AND token_hash = ?", now, req.ServiceID, existingHash)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
		} else {
			// Insert new record
			tokenHash, err := hashToken(req.Token)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
			_, err = db.Exec("INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)", req.ServiceID, tokenHash, now)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Heartbeat registered successfully"})
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		var req ServicesRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		if req.Token == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		rows, err := db.Query("SELECT service_id, token_hash, last_notification FROM services")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		var services []ServiceResponse
		for rows.Next() {
			var serviceID, tokenHash, lastNotification string
			if err := rows.Scan(&serviceID, &tokenHash, &lastNotification); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
			if bcrypt.CompareHashAndPassword([]byte(tokenHash), []byte(req.Token)) == nil {
				services = append(services, ServiceResponse{
					ServiceID:        serviceID,
					LastNotification: lastNotification,
				})
			}
		}
		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		if services == nil {
			services = []ServiceResponse{}
		}

		return c.Status(fiber.StatusOK).JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}