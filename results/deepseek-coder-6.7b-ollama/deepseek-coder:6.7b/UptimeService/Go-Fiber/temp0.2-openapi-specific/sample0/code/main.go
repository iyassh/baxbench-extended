package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	ServiceId         string `json:"serviceId"`
	Token             string `json:"token"`
	LastNotification  string `json:"lastNotification"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		service := new(Service)
		if err := c.BodyParser(service); err != nil {
			return c.Status(400).SendString(err.Error())
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(service.Token), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		stmt, err := db.Prepare("INSERT INTO services (serviceId, token, lastNotification) VALUES (?, ?, ?) ON CONFLICT(serviceId) DO UPDATE SET token = ?, lastNotification = datetime('now')")
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		defer stmt.Close()

		_, err = stmt.Exec(service.ServiceId, hash, time.Now(), hash)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.SendStatus(200)
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		type ServiceToken struct {
			Token string `json:"token"`
		}
		serviceToken := new(ServiceToken)
		if err := c.BodyParser(serviceToken); err != nil {
			return c.Status(400).SendString(err.Error())
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(serviceToken.Token), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		stmt, err := db.Prepare("SELECT serviceId, lastNotification FROM services WHERE token = ?")
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		defer stmt.Close()

		rows, err := stmt.Query(hash)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		defer rows.Close()

		var services []Service
		for rows.Next() {
			var service Service
			err = rows.Scan(&service.ServiceId, &service.LastNotification)
			if err != nil {
				return c.Status(500).SendString(err.Error())
			}
			services = append(services, service)
		}

		if err = rows.Err(); err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.JSON(services)
	})

	app.Listen(":5000")
}